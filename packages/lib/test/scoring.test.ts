import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addObservation,
  buildObservation,
  type Cluster,
  COMPONENT_WEIGHTS,
  coldStartSatisfied,
  makeDocument,
  ObservationStoreError,
  observationsPath,
  type PartialScore,
  partialScore,
  readObservations,
  resolveMentions,
  type ScanObservation,
} from "../src/index.js";

const BASE = Date.parse("2026-08-01T00:00:00.000Z");

function day(days: number): string {
  return new Date(BASE + days * 24 * 60 * 60 * 1000).toISOString();
}

function obs(overrides: Partial<ScanObservation> = {}, days = 0): ScanObservation {
  return {
    runId: `run-day-${days}`,
    scannedAt: day(days),
    clusters: 20,
    multiDocClusters: 5,
    crossSourceClusters: 2,
    textualDocuments: 100,
    largestClusterSize: 3,
    assetsMentioned: ["AAA"],
    marketAssets: ["AAA"],
    movers: [{ asset: "AAA", changePercent: 12 }],
    ...overrides,
  };
}

function component(result: PartialScore, name: string) {
  return result.components.find((c) => c.component === name);
}

function freshStore(): string {
  return mkdtempSync(join(tmpdir(), "resonance-obs-"));
}

function expectObservationError(fn: () => unknown, code: ObservationStoreError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ObservationStoreError);
    expect((error as ObservationStoreError).code).toBe(code);
    return;
  }
  expect.fail(`expected ObservationStoreError with code "${code}"`);
}

describe("component weights", () => {
  it("matches the approved scoring direction and sums to one", () => {
    expect(COMPONENT_WEIGHTS).toEqual({
      momentum: 0.3,
      novelty: 0.2,
      breadth: 0.15,
      unsaturation: 0.15,
      marketConfirmation: 0.1,
      investability: 0.1,
    });
    const total = Object.values(COMPONENT_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("coldStartSatisfied", () => {
  it("requires at least three observations", () => {
    expect(coldStartSatisfied([obs({}, 0), obs({}, 10)])).toBe(false);
  });

  it("requires a seven-day span", () => {
    expect(coldStartSatisfied([obs({}, 0), obs({}, 2), obs({}, 4)])).toBe(false);
  });

  it("passes with three observations over eight days", () => {
    expect(coldStartSatisfied([obs({}, 0), obs({}, 4), obs({}, 8)])).toBe(true);
  });

  it("ignores unparseable scan times", () => {
    expect(
      coldStartSatisfied([
        obs({ scannedAt: "not-a-date" }, 0),
        obs({ scannedAt: "not-a-date" }, 4),
        obs({ scannedAt: "not-a-date" }, 8),
      ]),
    ).toBe(false);
  });
});

describe("partialScore", () => {
  it("scores nothing without observations", () => {
    const result = partialScore([]);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.full).toBe(false);
    expect(result.components.every((c) => !c.available && c.reason === "missing-input")).toBe(true);
  });

  it("keeps attention components cold-started before the gate", () => {
    const result = partialScore([obs()]);
    for (const name of ["momentum", "novelty", "breadth", "unsaturation"]) {
      const c = component(result, name);
      expect(c?.available).toBe(false);
      expect(c?.reason).toBe("cold-start");
    }
    expect(component(result, "marketConfirmation")?.available).toBe(true);
    expect(component(result, "investability")?.available).toBe(true);
    expect(result.coverage).toBeCloseTo(0.2, 10);
    expect(result.full).toBe(false);
  });

  it("reweights available components into the partial score", () => {
    // Confirmation saturates at 1 (three confirming movers), investability
    // is 1 (AAA listed); partial = (0.1*1 + 0.1*1) / 0.2 = 1.
    const threeMovers = obs({
      movers: [
        { asset: "AAA", changePercent: 10 },
        { asset: "AAA", changePercent: 20 },
        { asset: "AAA", changePercent: 30 },
      ],
    });
    const result = partialScore([threeMovers]);
    expect(result.score).toBeCloseTo(1, 10);
  });

  it("delivers a full score once every component is available", () => {
    const series = [
      obs(
        { crossSourceClusters: 2, assetsMentioned: ["OLD"], marketAssets: ["NEW1"], movers: [] },
        0,
      ),
      obs(
        { crossSourceClusters: 3, assetsMentioned: ["OLD"], marketAssets: ["NEW1"], movers: [] },
        4,
      ),
      obs(
        {
          crossSourceClusters: 4,
          multiDocClusters: 5,
          assetsMentioned: ["NEW1"],
          marketAssets: ["NEW1"],
          largestClusterSize: 2,
          textualDocuments: 100,
          movers: [
            { asset: "NEW1", changePercent: 5 },
            { asset: "NEW1", changePercent: 8 },
            { asset: "NEW1", changePercent: 11 },
          ],
        },
        8,
      ),
    ];
    const result = partialScore(series);
    expect(result.full).toBe(true);
    expect(result.coverage).toBeCloseTo(1, 10);
    // momentum: growth (4-2)/2 = 1 -> 1.0; novelty: NEW1 unseen -> 1.0;
    // breadth: 4/5 = 0.8; unsaturation: 1 - 2/100 = 0.98; confirmation 1;
    // investability 1. Weighted: 0.3 + 0.2 + 0.12 + 0.147 + 0.1 + 0.1.
    expect(result.score).toBeCloseTo(0.967, 10);
  });

  it("measures momentum as relative cross-source growth", () => {
    const flat = [
      obs({ crossSourceClusters: 4 }, 0),
      obs({}, 4),
      obs({ crossSourceClusters: 4 }, 8),
    ];
    expect(component(partialScore(flat), "momentum")?.score).toBeCloseTo(0.5, 10);
    const tripling = [
      obs({ crossSourceClusters: 1 }, 0),
      obs({}, 4),
      obs({ crossSourceClusters: 3 }, 8),
    ];
    expect(component(partialScore(tripling), "momentum")?.score).toBeCloseTo(1, 10);
    const declining = [
      obs({ crossSourceClusters: 4 }, 0),
      obs({}, 4),
      obs({ crossSourceClusters: 2 }, 8),
    ];
    expect(component(partialScore(declining), "momentum")?.score).toBeCloseTo(0.25, 10);
  });

  it("measures novelty as the share of unseen mentioned assets", () => {
    const halfNew = [
      obs({ assetsMentioned: ["AAA"] }, 0),
      obs({}, 4),
      obs({ assetsMentioned: ["AAA", "BBB"] }, 8),
    ];
    expect(component(partialScore(halfNew), "novelty")?.score).toBeCloseTo(0.5, 10);
    const noAssets = [obs({}, 0), obs({}, 4), obs({ assetsMentioned: [] }, 8)];
    expect(component(partialScore(noAssets), "novelty")?.available).toBe(false);
    expect(component(partialScore(noAssets), "novelty")?.reason).toBe("missing-input");
  });

  it("measures breadth as the cross-source share of convergent events", () => {
    const series = [
      obs({}, 0),
      obs({}, 4),
      obs({ multiDocClusters: 8, crossSourceClusters: 6 }, 8),
    ];
    expect(component(partialScore(series), "breadth")?.score).toBeCloseTo(0.75, 10);
  });

  it("measures unsaturation as dispersed attention", () => {
    const dispersed = [
      obs({}, 0),
      obs({}, 4),
      obs({ largestClusterSize: 1, textualDocuments: 100 }, 8),
    ];
    expect(component(partialScore(dispersed), "unsaturation")?.score).toBeCloseTo(0.99, 10);
    const saturated = [
      obs({}, 0),
      obs({}, 4),
      obs({ largestClusterSize: 100, textualDocuments: 100 }, 8),
    ];
    expect(component(partialScore(saturated), "unsaturation")?.score).toBeCloseTo(0, 10);
  });

  it("requires movers and coverage for market confirmation", () => {
    const none = [obs({}, 0), obs({}, 4), obs({ movers: [] }, 8)];
    expect(component(partialScore(none), "marketConfirmation")?.reason).toBe("missing-input");
    const one = [obs({}, 0), obs({}, 4), obs({ movers: [{ asset: "AAA", changePercent: 9 }] }, 8)];
    expect(component(partialScore(one), "marketConfirmation")?.score).toBeCloseTo(1 / 3, 10);
  });

  it("measures investability against exchange listings", () => {
    const series = [
      obs({}, 0),
      obs({}, 4),
      obs({ assetsMentioned: ["AAA", "BBB"], marketAssets: ["AAA"] }, 8),
    ];
    expect(component(partialScore(series), "investability")?.score).toBeCloseTo(0.5, 10);
  });
});

describe("mention resolution", () => {
  function textualDoc(title: string, kind: "news" | "market" = "news") {
    return makeDocument(
      { sourceId: "rss-a", kind, url: `https://example.invalid/${title.length}`, title, text: "" },
      "2026-08-27T00:00:00.000Z",
    );
  }

  it("resolves mentions from titles of textual documents only", () => {
    const resolved = resolveMentions([
      textualDoc("Solana network upgrade ships"),
      textualDoc("Generic governance vote passes"),
      textualDoc("SOL pairs rally", "market"),
    ]);
    expect(resolved[0]?.asset).toBe("solana");
    expect(resolved[1]?.asset).toBeUndefined();
    expect(resolved[2]?.asset).toBeUndefined();
  });

  it("keeps assets that connectors already provided", () => {
    const existing = makeDocument(
      {
        sourceId: "rss-a",
        kind: "news",
        url: "https://example.invalid/7",
        title: "Ethereum news",
        text: "",
      },
      "2026-08-27T00:00:00.000Z",
      { asset: "CUSTOM" },
    );
    expect(resolveMentions([existing])[0]?.asset).toBe("CUSTOM");
  });
});

describe("buildObservation", () => {
  function doc(sourceId: string, kind: "news" | "release" | "market", asset?: string) {
    return makeDocument(
      {
        sourceId,
        kind,
        url: `https://example.invalid/${sourceId}/${asset ?? "x"}`,
        title: "t",
        text: "b",
      },
      "2026-08-27T00:00:00.000Z",
      asset !== undefined ? { asset } : {},
    );
  }

  function cluster(size: number, sourceIds: string[], clusterId: string): Cluster {
    return {
      clusterId,
      size,
      topTerms: [],
      docs: sourceIds.map((sourceId, i) => ({
        docId: `${clusterId}doc${i}aaaa`,
        sourceId,
        kind: "news" as const,
        title: `t${i}`,
        url: `https://example.invalid/${clusterId}/${i}`,
      })),
    };
  }

  it("derives the observation from locked-contract inputs", () => {
    const observation = buildObservation({
      runId: "2026-08-27T00-00-00",
      scannedAt: "2026-08-27T00:00:00.000Z",
      documents: [
        doc("rss-a", "news", "AAA"),
        doc("rss-b", "news", "BBB"),
        doc("rss-a", "news", "AAA"),
        doc("github-x", "release"),
        doc("binance-spot", "market", "AAA"),
      ],
      clusters: [cluster(2, ["rss-a", "rss-b"], "c000"), cluster(1, ["rss-a"], "c001")],
      movers: [{ asset: "AAA", changePercent: 15 }],
    });
    expect(observation.clusters).toBe(2);
    expect(observation.multiDocClusters).toBe(1);
    expect(observation.crossSourceClusters).toBe(1);
    expect(observation.textualDocuments).toBe(4);
    expect(observation.largestClusterSize).toBe(2);
    expect(observation.assetsMentioned).toEqual(["AAA", "BBB"]);
    expect(observation.marketAssets).toEqual(["AAA"]);
    expect(observation.movers).toEqual([{ asset: "AAA", changePercent: 15 }]);
  });

  it("resolves mentions when documents carry no asset", () => {
    const observation = buildObservation({
      runId: "run-r",
      scannedAt: "2026-08-27T00:00:00.000Z",
      documents: [
        makeDocument(
          {
            sourceId: "rss-a",
            kind: "news",
            url: "https://example.invalid/3",
            title: "Solana at ATH",
            text: "",
          },
          "2026-08-27T00:00:00.000Z",
        ),
      ],
      clusters: [],
    });
    expect(observation.assetsMentioned).toEqual(["solana"]);
  });

  it("defaults movers to none", () => {
    const observation = buildObservation({
      runId: "run-1",
      scannedAt: "2026-08-27T00:00:00.000Z",
      documents: [],
      clusters: [],
    });
    expect(observation.movers).toEqual([]);
    expect(observation.assetsMentioned).toEqual([]);
  });
});

describe("observation ledger", () => {
  it("appends observations and reads them back in order", () => {
    const store = freshStore();
    addObservation(store, obs({}, 0));
    addObservation(store, obs({}, 8));
    const read = readObservations(store);
    expect(read.map((o) => o.runId)).toEqual(["run-day-0", "run-day-8"]);
  });

  it("refuses duplicate run ids and traversal-unsafe ids", () => {
    const store = freshStore();
    addObservation(store, obs({}, 0));
    expectObservationError(() => addObservation(store, obs({}, 0)), "duplicate-run-id");
    expectObservationError(
      () => addObservation(store, obs({ runId: "../escape" })),
      "invalid-run-id",
    );
  });

  it("serializes deterministically", () => {
    const storeA = freshStore();
    const storeB = freshStore();
    addObservation(storeA, obs({}, 0));
    addObservation(storeB, obs({}, 0));
    expect(readFileSync(observationsPath(storeA), "utf8")).toBe(
      readFileSync(observationsPath(storeB), "utf8"),
    );
  });

  it("returns an empty list for a fresh store", () => {
    expect(readObservations(freshStore())).toEqual([]);
  });
});
