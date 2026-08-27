import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventGroup, GroupingRecord } from "../src/grouping.js";
import type { Snapshot } from "../src/index.js";
import { makeDocument } from "../src/index.js";
import type { Narrative } from "../src/narratives.js";
import {
  alphaSignalsSheet,
  EVIDENCE_UNTRUSTED_WARNING,
  marketSheet,
  narrativePack,
  tvlSheet,
  writeEvidencePacks,
} from "../src/research.js";
import type { PartialScore } from "../src/scoring.js";

const CAPTURED = "2026-08-27T00:00:00.000Z";

function doc(
  title: string,
  kind: "news" | "release" | "market" = "news",
): ReturnType<typeof makeDocument> {
  return makeDocument(
    {
      sourceId: kind === "market" ? "binance" : "coindesk-rss",
      kind,
      url: `https://example.com/${title}`,
      title,
      text: `${title} body text. ${title} says more.`,
    },
    CAPTURED,
    { publishedAt: "2026-08-26T12:00:00.000Z" },
  );
}

const snapshot: Snapshot = {
  schemaVersion: "0.1",
  runId: "2026-08-27T00-00-00",
  createdAt: CAPTURED,
  connectors: [],
  documents: [doc("News one"), doc("News two"), doc("BTC ticker", "market")],
};

const group: EventGroup = {
  groupId: "g001",
  title: "News one event",
  rationale: "same event across sources",
  docIds: [],
  narrativeId: "n0001",
};

const grouping: GroupingRecord = {
  schemaVersion: "0.1",
  runId: snapshot.runId,
  groupedAt: CAPTURED,
  model: "test-agent",
  rulesVersion: "1",
  groups: [group],
};

const narrative: Narrative = {
  narrativeId: "n0001",
  title: "News one event",
  theme: "News one event",
  establishedRunId: snapshot.runId,
  lastSeenRunId: snapshot.runId,
};

const score: PartialScore = {
  components: [
    { component: "momentum", weight: 0.3, available: true, score: 0.5 },
    { component: "novelty", weight: 0.2, available: false, reason: "cold-start" },
  ],
  score: 0.5,
  coverage: 0.3,
  full: false,
};

const tmpDirs: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "research-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("reference sheets", () => {
  it("renders market documents with bounded excerpts", () => {
    const sheet = marketSheet(snapshot);
    expect(sheet).toContain("# reference: market");
    expect(sheet).toContain("BTC ticker");
    expect(sheet).not.toContain("News one");
  });

  it("renders tvl sheet with empty notice when no tvl documents", () => {
    const sheet = tvlSheet(snapshot);
    expect(sheet).toContain("_No documents of these kinds in this snapshot._");
  });

  it("renders alpha signals sheet", () => {
    const sheet = alphaSignalsSheet(snapshot);
    expect(sheet).toContain("# reference: alpha signals");
    expect(sheet).toContain("_No documents of these kinds in this snapshot._");
  });
});

describe("narrativePack", () => {
  it("renders identity, groups, rationale, and the untrusted-data warning", () => {
    const pack = narrativePack(narrative, [group], snapshot.documents, score);
    expect(pack).toContain("# n0001: News one event");
    expect(pack).toContain(EVIDENCE_UNTRUSTED_WARNING);
    expect(pack).toContain("Rationale: same event across sources");
    expect(pack).toContain("Score: 0.500 at coverage 0.30");
    expect(pack).toContain("novelty=unavailable(cold-start)");
  });

  it("omits score line details when no score is supplied", () => {
    const pack = narrativePack(narrative, [group], snapshot.documents);
    expect(pack).toContain("Score: not computed.");
  });

  it("scores with null score report honestly", () => {
    const empty: PartialScore = { ...score, score: null, components: [] };
    const pack = narrativePack(narrative, [group], snapshot.documents, empty);
    expect(pack).toContain("Score: none (no available components).");
  });
});

describe("writeEvidencePacks", () => {
  it("writes one pack per grouped narrative plus references and index", () => {
    const runDir = makeTmp();
    const manifest = writeEvidencePacks(runDir, {
      snapshot,
      grouping,
      narratives: [narrative],
      scores: new Map([["n0001", score]]),
    });
    expect(manifest.packs).toEqual(["n0001.md"]);
    expect(manifest.references).toEqual([
      "reference-market.md",
      "reference-tvl.md",
      "reference-alpha-signals.md",
    ]);
    const files = readdirSync(join(runDir, "evidence")).sort();
    expect(files).toEqual([
      "index.md",
      "n0001.md",
      "reference-alpha-signals.md",
      "reference-market.md",
      "reference-tvl.md",
    ]);
    const index = readFileSync(join(runDir, "evidence", "index.md"), "utf8");
    expect(index).toContain("| [n0001](./n0001.md) | News one event | 1 groups |");
    const pack = readFileSync(join(runDir, "evidence", "n0001.md"), "utf8");
    expect(pack).toContain("Score: 0.500 at coverage 0.30");
  });

  it("skips narratives without groups and ungrouped narratives", () => {
    const runDir = makeTmp();
    const idle: Narrative = { ...narrative, narrativeId: "n0002", title: "Idle" };
    const manifest = writeEvidencePacks(runDir, {
      snapshot,
      grouping,
      narratives: [narrative, idle],
    });
    expect(manifest.packs).toEqual(["n0001.md"]);
  });

  it("writes no packs when the grouping has no narratives", () => {
    const runDir = makeTmp();
    const manifest = writeEvidencePacks(runDir, {
      snapshot,
      grouping: { ...grouping, groups: [] },
      narratives: [narrative],
    });
    expect(manifest.packs).toEqual([]);
    const index = readFileSync(join(runDir, "evidence", "index.md"), "utf8");
    expect(index).toContain("# Evidence packs");
  });

  it("is deterministic for identical inputs", () => {
    const a = makeTmp();
    const b = makeTmp();
    writeEvidencePacks(a, { snapshot, grouping, narratives: [narrative] });
    writeEvidencePacks(b, { snapshot, grouping, narratives: [narrative] });
    const packA = readFileSync(join(a, "evidence", "n0001.md"), "utf8");
    const packB = readFileSync(join(b, "evidence", "n0001.md"), "utf8");
    expect(packA).toBe(packB);
  });
});
