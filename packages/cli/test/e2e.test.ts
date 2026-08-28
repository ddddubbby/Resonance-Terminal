/**
 * End-to-end private-alpha integration: the complete protocol wired from
 * the merged pipeline, offline. Two fake connectors (an RSS feed pair and
 * the Binance tape) stand in for the live families; everything else —
 * normalization, snapshots, clustering, grouping records, narrative
 * identity, observations, evidence packs, scoring, promotion, and the
 * handoff rendering — runs exactly as merged.
 *
 * Three scans span fifteen days so the per-narrative cold-start gate
 * (3 observations over >= 7 days) opens honestly inside one test.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addObservation,
  applyGrouping,
  buildNarrativeObservation,
  type CapturingConnector,
  type ConnectorResult,
  GROUPING_RULES_VERSION,
  GROUPING_SCHEMA_VERSION,
  type GroupingRecord,
  readGrouping,
  readNarratives,
  readObservations,
  readSnapshot,
  runDirOf,
  runScan,
  scoreAll,
  screenMovers,
  withAllocatedNarrativeIds,
  writeEvidencePacks,
  writeGrouping,
} from "@resonance/lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";

function captureOutput() {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return { stdout, stderr };
}

function output(spy: { readonly mock: { readonly calls: readonly unknown[][] } }): string {
  return spy.mock.calls.map((call) => String(call[0])).join("");
}

const tmpDirs: string[] = [];
function freshStore(): string {
  const dir = mkdtempSync(join(tmpdir(), "resonance-e2e-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fake connectors
// ---------------------------------------------------------------------------

function feedXml(headline: string, path: string): string {
  return `<rss><channel>
    <item>
      <title>${headline}</title>
      <link>https://feed-a.example/${path}</link>
      <pubDate>Mon, 01 Jun 2026 08:00:00 GMT</pubDate>
      <description><![CDATA[${headline} — details from feed A.]]></description>
    </item>
  </channel></rss>`;
}

class FakeFeed implements CapturingConnector {
  readonly kind = "feed" as const;
  constructor(
    readonly id: string,
    private readonly xml: string,
  ) {}
  async fetchCapture() {
    return {
      connectorId: this.id,
      url: `https://${this.id}.example/feed`,
      ok: true,
      fetchedAt: "2026-06-01T08:00:00.000Z",
      payload: this.xml,
    };
  }
  async fetch(): Promise<ConnectorResult> {
    return {
      connectorId: this.id,
      kind: this.kind,
      ok: true,
      status: 200,
      capturedAt: "2026-06-01T08:00:00.000Z",
    };
  }
}

class FakeBinance implements CapturingConnector {
  readonly kind = "market" as const;
  readonly id = "binance-spot";
  private readonly payload = [
    {
      symbol: "BTCUSDT",
      lastPrice: "120000",
      priceChangePercent: "14.2",
      quoteVolume: "900000000",
    },
    {
      symbol: "PEPEUSDT",
      lastPrice: "0.00002",
      priceChangePercent: "31.5",
      quoteVolume: "80000000",
    },
  ];
  async fetchCapture() {
    return {
      connectorId: this.id,
      url: "https://data-api.binance.vision/api/v3/ticker/24hr",
      ok: true,
      fetchedAt: "2026-06-01T08:00:00.000Z",
      payload: this.payload,
    };
  }
  async fetch(): Promise<ConnectorResult> {
    return {
      connectorId: this.id,
      kind: this.kind,
      ok: true,
      status: 200,
      capturedAt: "2026-06-01T08:00:00.000Z",
    };
  }
}

// ---------------------------------------------------------------------------
// One protocol pass (steps 1-5 of docs/PROTOCOL.md), agent-side included
// ---------------------------------------------------------------------------

interface PassResult {
  readonly runId: string;
  readonly narrativeId: string;
  readonly attentionGated: boolean;
}

async function protocolPass(
  store: string,
  day: number,
  opts: { readonly matchExisting: boolean },
): Promise<PassResult> {
  const date = new Date(Date.UTC(2026, 5, 1 + day * 7, 8, 0, 0));
  const summary = await runScan(store, {
    connectors: [
      new FakeFeed("rss-feed-a", feedXml("Stablecoin payments network expands", `a-${day}`)),
      new FakeFeed("rss-feed-b", feedXml("Stablecoin payments network expands", `b-${day}`)),
      new FakeBinance(),
    ],
    now: () => date,
  });
  expect(summary.documents).toBeGreaterThan(0);

  // Step 1 — agent-side grouping over the textual corpus.
  const snapshot = readSnapshot(store, summary.runId);
  expect(snapshot).not.toBeNull();
  if (snapshot === null) {
    throw new Error("snapshot missing after scan");
  }
  const textual = snapshot.documents.filter((d) => d.kind === "news" || d.kind === "release");
  const narrativesBefore = readNarratives(store);
  const matching = narrativesBefore.find((n) => n.title.includes("Stablecoin payments"));
  const group = {
    groupId: `g${String(day).padStart(3, "0")}`,
    title: "Stablecoin payments network expands",
    rationale: "Both feeds report the same network expansion event on the same day.",
    docIds: textual.map((d) => d.docId),
    ...(opts.matchExisting && matching !== undefined ? { narrativeId: matching.narrativeId } : {}),
  };
  const record: GroupingRecord = {
    schemaVersion: GROUPING_SCHEMA_VERSION,
    runId: summary.runId,
    groupedAt: date.toISOString(),
    model: "e2e-agent",
    rulesVersion: GROUPING_RULES_VERSION,
    groups: [group],
  };
  const runDir = runDirOf(store, summary.runId);
  writeGrouping(runDir, record);

  // Step 2 — identity: library-side allocation or verified matching.
  const applied = applyGrouping(store, record);
  const withIds = withAllocatedNarrativeIds(readGrouping(runDir) as GroupingRecord, applied);
  const narrativeId = withIds.groups[0]?.narrativeId;
  expect(narrativeId).toBeDefined();
  if (narrativeId === undefined) {
    throw new Error("narrativeId not allocated");
  }

  // Step 3 — observation, one per narrative per scan.
  const binanceCapture = {
    connectorId: "binance-spot",
    url: "https://data-api.binance.vision/api/v3/ticker/24hr",
    ok: true as const,
    fetchedAt: date.toISOString(),
    payload: [
      {
        symbol: "BTCUSDT",
        lastPrice: "120000",
        priceChangePercent: "14.2",
        quoteVolume: "900000000",
      },
    ],
  };
  addObservation(
    store,
    buildNarrativeObservation({
      runId: summary.runId,
      scannedAt: date.toISOString(),
      narrativeId,
      narrativeDocuments: snapshot.documents.filter((d) => group.docIds.includes(d.docId)),
      corpus: snapshot.documents,
      movers: screenMovers(binanceCapture),
    }),
  );

  // Step 4 — evidence packs from the id-attached record.
  const scores = scoreAll(readObservations(store));
  const manifest = writeEvidencePacks(runDir, {
    snapshot,
    grouping: withIds,
    narratives: readNarratives(store),
    scores,
  });
  expect(manifest.packs).toContain(`${narrativeId}.md`);
  expect(existsSync(join(runDir, "evidence", "index.md"))).toBe(true);

  // Step 5 — honest scoring.
  const score = scores.get(narrativeId);
  const attentionGated =
    score?.components.find((c) => c.component === "momentum")?.available === false;
  return { runId: summary.runId, narrativeId, attentionGated };
}

// ---------------------------------------------------------------------------
// The full loop
// ---------------------------------------------------------------------------

describe("private-alpha end-to-end protocol", () => {
  it("runs three scans across fifteen days with honest scores", async () => {
    const store = freshStore();

    const first = await protocolPass(store, 0, { matchExisting: false });
    expect(first.narrativeId).toBe("n0001");
    expect(first.attentionGated).toBe(true); // cold-start: one observation

    const second = await protocolPass(store, 1, { matchExisting: true });
    expect(second.narrativeId).toBe("n0001"); // matched, not reallocated
    expect(second.attentionGated).toBe(true); // cold-start: span < 7 days

    const third = await protocolPass(store, 2, { matchExisting: true });
    expect(third.narrativeId).toBe("n0001");
    expect(third.attentionGated).toBe(false); // gate open: 3 obs over 14 days

    const scores = scoreAll(readObservations(store));
    const final = scores.get("n0001");
    expect(final?.score).not.toBeNull();
    expect(final?.components.length).toBe(6);
    const momentum = final?.components.find((c) => c.component === "momentum");
    expect(momentum?.available).toBe(true);
    expect(readObservations(store).length).toBe(3);
  }, 20_000);

  it("wires the CLI on top of the populated store", async () => {
    const store = freshStore();
    await protocolPass(store, 0, { matchExisting: false });
    await protocolPass(store, 1, { matchExisting: true });
    await protocolPass(store, 2, { matchExisting: true });

    const status = captureOutput();
    expect(await run(["status", "--store", store, "--json"])).toBe(0);
    const state = JSON.parse(output(status.stdout)) as Record<string, unknown>;
    expect(state.runs).toBe(3);
    expect(state.narratives).toBe(1);
    expect(state.observations).toBe(3);
    vi.restoreAllMocks();

    const candidates = captureOutput();
    expect(await run(["candidates", "--store", store])).toBe(0);
    expect(output(candidates.stdout)).toContain("n0001");
    vi.restoreAllMocks();

    const promote = captureOutput();
    expect(
      await run(["promote", "--narrative", "n0001", "--note", "e2e soak", "--store", store]),
    ).toBe(0);
    expect(output(promote.stdout)).toContain("promoted n0001");
    vi.restoreAllMocks();

    const handoff = captureOutput();
    expect(await run(["handoff", "--store", store])).toBe(0);
    const text = output(handoff.stdout);
    expect(text).toContain("[promoted]");
    expect(text).toContain("n0001");
    expect(text).toContain("coverage");
  }, 30_000);

  it("keeps every run artifact beside its snapshot", async () => {
    const store = freshStore();
    const pass = await protocolPass(store, 0, { matchExisting: false });
    const runDir = runDirOf(store, pass.runId);
    for (const file of ["snapshot.json", "grouping.json", "clusters.json"]) {
      expect(existsSync(join(runDir, file))).toBe(true);
    }
    expect(existsSync(join(runDir, "raw"))).toBe(true);
    const snapshot = JSON.parse(readFileSync(join(runDir, "snapshot.json"), "utf8")) as {
      runId: string;
    };
    expect(snapshot.runId).toBe(pass.runId);
  }, 20_000);
});
