import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addObservation,
  buildNarrativeObservation,
  COMPONENT_WEIGHTS,
  coldStartSatisfied,
  makeDocument,
  type NarrativeObservation,
  narrativeScore,
  ObservationStoreError,
  observationsPath,
  type PartialScore,
  readObservations,
  resolveMentions,
  scoreAll,
} from "../src/index.js";

const BASE = Date.parse("2026-08-01T00:00:00.000Z");

function day(days: number): string {
  return new Date(BASE + days * 24 * 60 * 60 * 1000).toISOString();
}

function obs(overrides: Partial<NarrativeObservation> = {}, days = 0): NarrativeObservation {
  return {
    runId: `run-day-${days}`,
    scannedAt: day(days),
    narrativeId: "n0001",
    documents: 4,
    sources: 2,
    assetsMentioned: ["AAA"],
    marketAssets: ["AAA"],
    movers: [{ asset: "AAA", changePercent: 12 }],
    corpusDocuments: 100,
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
        { scannedAt: "not-a-date" },
        { scannedAt: "not-a-date" },
        { scannedAt: "not-a-date" },
      ]),
    ).toBe(false);
  });
});

describe("narrativeScore", () => {
  it("scores nothing without observations", () => {
    const result = narrativeScore([]);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.full).toBe(false);
    expect(result.components.every((c) => !c.available && c.reason === "missing-input")).toBe(true);
  });

  it("keeps attention components cold-started before the gate", () => {
    const result = narrativeScore([obs()]);
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
    const result = narrativeScore([threeMovers]);
    expect(result.score).toBeCloseTo(1, 10);
  });

  it("delivers a full score once every component is available", () => {
    const series = [
      obs({ documents: 2, assetsMentioned: ["OLD"], movers: [] }, 0),
      obs({ documents: 3, assetsMentioned: ["OLD"], movers: [] }, 4),
      obs(
        {
          documents: 4,
          sources: 4,
          assetsMentioned: ["NEW1"],
          marketAssets: ["NEW1"],
          corpusDocuments: 100,
          movers: [
            { asset: "NEW1", changePercent: 5 },
            { asset: "NEW1", changePercent: 8 },
            { asset: "NEW1", changePercent: 11 },
          ],
        },
        8,
      ),
    ];
    const result = narrativeScore(series);
    expect(result.full).toBe(true);
    expect(result.coverage).toBeCloseTo(1, 10);
    // momentum: growth (4-2)/2 = 1 -> 1.0; novelty: NEW1 unseen -> 1.0;
    // breadth: (4-1)/3 = 1.0; unsaturation: 1 - 4/100 = 0.96; confirmation
    // 1; investability 1. Weighted: 0.3 + 0.2 + 0.15 + 0.144 + 0.1 + 0.1.
    expect(result.score).toBeCloseTo(0.994, 10);
  });

  it("measures momentum as relative growth of the narrative's coverage", () => {
    const flat = [obs({ documents: 4 }, 0), obs({}, 4), obs({ documents: 4 }, 8)];
    expect(component(narrativeScore(flat), "momentum")?.score).toBeCloseTo(0.5, 10);
    const tripling = [obs({ documents: 2 }, 0), obs({}, 4), obs({ documents: 6 }, 8)];
    expect(component(narrativeScore(tripling), "momentum")?.score).toBeCloseTo(1, 10);
    const declining = [obs({ documents: 4 }, 0), obs({}, 4), obs({ documents: 2 }, 8)];
    expect(component(narrativeScore(declining), "momentum")?.score).toBeCloseTo(0.25, 10);
  });

  it("measures novelty as the share of unseen mentioned assets", () => {
    const halfNew = [
      obs({ assetsMentioned: ["AAA"] }, 0),
      obs({}, 4),
      obs({ assetsMentioned: ["AAA", "BBB"] }, 8),
    ];
    expect(component(narrativeScore(halfNew), "novelty")?.score).toBeCloseTo(0.5, 10);
    const noAssets = [obs({}, 0), obs({}, 4), obs({ assetsMentioned: [] }, 8)];
    expect(component(narrativeScore(noAssets), "novelty")?.available).toBe(false);
    expect(component(narrativeScore(noAssets), "novelty")?.reason).toBe("missing-input");
  });

  it("measures breadth as source convergence", () => {
    const one = [obs({}, 0), obs({}, 4), obs({ sources: 1 }, 8)];
    expect(component(narrativeScore(one), "breadth")?.score).toBeCloseTo(0, 10);
    const two = [obs({}, 0), obs({}, 4), obs({ sources: 2 }, 8)];
    expect(component(narrativeScore(two), "breadth")?.score).toBeCloseTo(1 / 3, 10);
    const many = [obs({}, 0), obs({}, 4), obs({ sources: 6 }, 8)];
    expect(component(narrativeScore(many), "breadth")?.score).toBeCloseTo(1, 10);
    const none = [obs({}, 0), obs({}, 4), obs({ documents: 0, sources: 0 }, 8)];
    expect(component(narrativeScore(none), "breadth")?.reason).toBe("missing-input");
  });

  it("measures unsaturation as remaining attention headroom", () => {
    const sliver = [obs({}, 0), obs({}, 4), obs({ documents: 1 }, 8)];
    expect(component(narrativeScore(sliver), "unsaturation")?.score).toBeCloseTo(0.99, 10);
    const dominant = [obs({}, 0), obs({}, 4), obs({ documents: 100, corpusDocuments: 100 }, 8)];
    expect(component(narrativeScore(dominant), "unsaturation")?.score).toBeCloseTo(0, 10);
    const emptyCorpus = [obs({}, 0), obs({}, 4), obs({ corpusDocuments: 0 }, 8)];
    expect(component(narrativeScore(emptyCorpus), "unsaturation")?.reason).toBe("missing-input");
  });

  it("requires movers and mentions for market confirmation", () => {
    const none = [obs({}, 0), obs({}, 4), obs({ movers: [] }, 8)];
    expect(component(narrativeScore(none), "marketConfirmation")?.reason).toBe("missing-input");
    const one = [obs({}, 0), obs({}, 4), obs({ movers: [{ asset: "AAA", changePercent: 9 }] }, 8)];
    expect(component(narrativeScore(one), "marketConfirmation")?.score).toBeCloseTo(1 / 3, 10);
  });

  it("measures investability against exchange listings", () => {
    const series = [
      obs({}, 0),
      obs({}, 4),
      obs({ assetsMentioned: ["AAA", "BBB"], marketAssets: ["AAA"] }, 8),
    ];
    expect(component(narrativeScore(series), "investability")?.score).toBeCloseTo(0.5, 10);
  });
});

describe("scoreAll", () => {
  it("scores every narrative of a ledger independently", () => {
    const scores = scoreAll([
      obs({}, 0),
      obs({ narrativeId: "n0002", movers: [], assetsMentioned: [] }, 0),
      obs({}, 8),
    ]);
    expect(scores.size).toBe(2);
    expect(scores.get("n0001")?.components.length).toBe(6);
    expect(scores.get("n0002")?.score).toBeNull();
  });
});

describe("mention resolution", () => {
  function textualDoc(title: string, kind: "news" | "market" = "news") {
    return makeDocument(
      {
        sourceId: "rss-a",
        kind,
        url: `https://example.invalid/${title.length}`,
        title,
        text: "",
      },
      "2026-08-27T00:00:00.000Z",
    );
  }

  it("resolves mentions from titles of textual documents only", () => {
    // A market document with an asset is what puts SOL in the tradeable
    // universe; without one the index has nothing to resolve against.
    const universe = makeDocument(
      {
        sourceId: "binance-spot",
        kind: "market",
        url: "https://example.invalid/market/SOL",
        title: "Binance SOL/USDT 24h +1%",
        text: "",
      },
      "2026-08-27T00:00:00.000Z",
      { asset: "SOL" },
    );
    const resolved = resolveMentions([
      textualDoc("Solana network upgrade ships"),
      textualDoc("Generic governance vote passes"),
      textualDoc("SOL pairs rally", "market"),
      universe,
    ]);
    expect(resolved[0]?.asset).toBe("SOL");
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

describe("buildNarrativeObservation", () => {
  function doc(
    sourceId: string,
    kind: "news" | "release" | "market",
    title: string,
    asset?: string,
  ) {
    return makeDocument(
      {
        sourceId,
        kind,
        url: `https://example.invalid/${sourceId}/${title.length}`,
        title,
        text: "",
      },
      "2026-08-27T00:00:00.000Z",
      asset !== undefined ? { asset } : {},
    );
  }

  it("derives the observation from locked-contract inputs", () => {
    const observation = buildNarrativeObservation({
      runId: "2026-08-27T00-00-00",
      scannedAt: "2026-08-27T00:00:00.000Z",
      narrativeId: "n0001",
      narrativeDocuments: [
        doc("rss-a", "news", "Solana network upgrade ships"),
        doc("rss-b", "news", "Solana ships upgrade"),
        doc("rss-a", "news", "Unrelated governance vote"),
      ],
      corpus: [
        doc("rss-a", "news", "Solana network upgrade ships"),
        doc("rss-b", "news", "Solana ships upgrade"),
        doc("rss-a", "news", "Unrelated governance vote"),
        doc("binance-spot", "market", "SOL pairs rally", "SOL"),
        doc("binance-spot", "market", "BTC pairs rally", "BTC"),
      ],
      movers: [{ asset: "sol", changePercent: 15 }],
    });
    expect(observation.documents).toBe(3);
    expect(observation.sources).toBe(2);
    expect(observation.assetsMentioned).toEqual(["SOL"]);
    expect(observation.marketAssets).toEqual(["BTC", "SOL"]);
    expect(observation.movers).toEqual([{ asset: "sol", changePercent: 15 }]);
    expect(observation.corpusDocuments).toBe(3);
  });

  it("defaults movers to none", () => {
    const observation = buildNarrativeObservation({
      runId: "run-1",
      scannedAt: "2026-08-27T00:00:00.000Z",
      narrativeId: "n0001",
      narrativeDocuments: [],
      corpus: [],
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

  it("allows one observation per narrative per run", () => {
    const store = freshStore();
    addObservation(store, obs({}, 0));
    addObservation(store, obs({ narrativeId: "n0002" }, 0));
    expect(readObservations(store)).toHaveLength(2);
    expectObservationError(() => addObservation(store, obs({}, 0)), "duplicate-observation");
  });

  it("refuses traversal-unsafe run ids", () => {
    const store = freshStore();
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
