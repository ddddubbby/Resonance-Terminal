import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addObservation,
  applyGrouping,
  buildNarrativeObservation,
  GROUPING_RULES_VERSION,
  GROUPING_SCHEMA_VERSION,
  type GroupingRecord,
  makeDocument,
  type ScanSummary,
  writeGrouping,
  writeSnapshot,
} from "@resonance/lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run, VERSION } from "../src/cli.js";

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
  const dir = mkdtempSync(join(tmpdir(), "resonance-cli-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function summary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    runId: "2026-08-27T12-00-00",
    runDir: "/tmp/resonance/runs/2026-08-27T12-00-00",
    connectors: [
      {
        connectorId: "binance-spot",
        kind: "market",
        ok: true,
        capturedAt: "2026-08-27T12:00:00.000Z",
      },
    ],
    documents: 120,
    clusters: 12,
    degraded: false,
    ...overrides,
  };
}

function groupingRecord(runId: string): GroupingRecord {
  return {
    schemaVersion: GROUPING_SCHEMA_VERSION,
    runId,
    groupedAt: "2026-08-27T12:30:00.000Z",
    model: "test-agent",
    rulesVersion: GROUPING_RULES_VERSION,
    groups: [
      {
        groupId: "g001",
        title: "Stablecoin payments",
        rationale: "Same event across two feeds.",
        docIds: ["aaaaaaaaaaaa"],
      },
    ],
  };
}

describe("help and version", () => {
  it("prints help and exits 0 for --help", async () => {
    const { stdout } = captureOutput();
    expect(await run(["--help"])).toBe(0);
    expect(output(stdout)).toContain("Usage:");
    expect(output(stdout)).toContain("resonance scan");
    expect(output(stdout)).toContain("resonance handoff");
  });

  it("prints help and exits 0 when called without arguments", async () => {
    const { stdout } = captureOutput();
    expect(await run([])).toBe(0);
    expect(output(stdout)).toContain("resonance");
  });

  it("prints the version and exits 0 for --version", async () => {
    const { stdout } = captureOutput();
    expect(await run(["--version"])).toBe(0);
    expect(output(stdout)).toBe(`${VERSION}\n`);
  });

  it("reports unknown commands on stderr and exits 1", async () => {
    const { stdout, stderr } = captureOutput();
    expect(await run(["fly"])).toBe(1);
    expect(output(stdout)).toBe("");
    expect(output(stderr)).toContain("unknown command");
  });
});

describe("scan", () => {
  it("reports the summary and exits 0 on a clean scan", async () => {
    const { stdout } = captureOutput();
    const scan = vi.fn(async () => summary());
    expect(await run(["scan", "--store", freshStore()], { scan })).toBe(0);
    expect(output(stdout)).toContain("120 documents");
    expect(scan).toHaveBeenCalledOnce();
  });

  it("lists failed connectors and exits 2 on a degraded scan", async () => {
    const { stdout } = captureOutput();
    const degraded = summary({
      degraded: true,
      connectors: [
        {
          connectorId: "rss-coindesk",
          kind: "feed",
          ok: false,
          capturedAt: "2026-08-27T12:00:00.000Z",
          error: "HTTP 503",
        },
      ],
    });
    expect(await run(["scan"], { scan: async () => degraded })).toBe(2);
    expect(output(stdout)).toContain("degraded: rss-coindesk");
  });

  it("prints JSON and exits 0 with --json", async () => {
    const { stdout } = captureOutput();
    expect(await run(["scan", "--json"], { scan: async () => summary() })).toBe(0);
    const parsed = JSON.parse(output(stdout)) as ScanSummary;
    expect(parsed.runId).toBe("2026-08-27T12-00-00");
    expect(parsed.documents).toBe(120);
  });

  it("reports failures and exits 1 when the scan throws", async () => {
    const { stderr } = captureOutput();
    expect(
      await run(["scan"], { scan: async () => Promise.reject(new Error("no documents")) }),
    ).toBe(1);
    expect(output(stderr)).toContain("scan failed");
  });
});

describe("status", () => {
  it("reports an empty store honestly", async () => {
    const { stdout } = captureOutput();
    expect(await run(["status", "--store", freshStore()])).toBe(0);
    expect(output(stdout)).toContain("no runs yet");
  });

  it("prints JSON with ledger counts", async () => {
    const store = freshStore();
    applyGrouping(store, groupingRecord("run-1"));
    const { stdout } = captureOutput();
    expect(await run(["status", "--store", store, "--json"])).toBe(0);
    const parsed = JSON.parse(output(stdout)) as Record<string, unknown>;
    expect(parsed.narratives).toBe(1);
  });
});

describe("promote", () => {
  it("promotes an existing narrative", async () => {
    const store = freshStore();
    applyGrouping(store, groupingRecord("run-1"));
    const { stdout } = captureOutput();
    expect(await run(["promote", "--narrative", "n0001", "--store", store])).toBe(0);
    expect(output(stdout)).toContain("promoted n0001");
  });

  it("refuses unknown narratives and exits 1", async () => {
    const { stderr } = captureOutput();
    expect(await run(["promote", "--narrative", "n0001", "--store", freshStore()])).toBe(1);
    expect(output(stderr)).toContain("does not exist");
  });

  it("refuses a second promotion of the same narrative", async () => {
    const store = freshStore();
    applyGrouping(store, groupingRecord("run-1"));
    captureOutput();
    await run(["promote", "--narrative", "n0001", "--store", store]);
    const { stderr } = captureOutput();
    expect(await run(["promote", "--narrative", "n0001", "--store", store])).toBe(1);
    expect(output(stderr)).toContain("already promoted");
  });

  it("needs --narrative and exits 1 without it", async () => {
    const { stderr } = captureOutput();
    expect(await run(["promote"])).toBe(1);
    expect(output(stderr)).toContain("--narrative");
  });
});

describe("candidates", () => {
  it("says so honestly when the latest run has no grouping", async () => {
    const store = freshStore();
    const { stdout } = captureOutput();
    expect(await run(["candidates", "--store", store])).toBe(1);
    expect(output(stdout)).toBe("");
  });

  it("scores grouped narratives with honest components", async () => {
    const store = freshStore();
    const record = groupingRecord("run-1");
    writeGrouping(join(store, "run-1"), record);
    applyGrouping(store, record);
    const doc = makeDocument(
      {
        sourceId: "rss-coindesk",
        kind: "news",
        url: "https://example.com/a",
        title: "Stablecoin payments grow",
        text: "Stablecoin payments grow across chains.",
      },
      "2026-08-27T12:00:00.000Z",
    );
    writeSnapshot(store, {
      schemaVersion: "0.1",
      runId: "run-1",
      createdAt: "2026-08-27T12:00:00.000Z",
      connectors: [],
      documents: [doc],
    });
    addObservation(
      store,
      buildNarrativeObservation({
        runId: "run-1",
        scannedAt: "2026-08-27T12:30:00.000Z",
        narrativeId: "n0001",
        narrativeDocuments: [doc],
        corpus: [doc],
      }),
    );
    const { stdout } = captureOutput();
    expect(await run(["candidates", "--store", store])).toBe(0);
    const text = output(stdout);
    expect(text).toContain("n0001");
    expect(text).toContain("unavailable");
    vi.restoreAllMocks();
    const jsonCapture = captureOutput();
    expect(await run(["candidates", "--store", store, "--json"])).toBe(0);
    const parsed = JSON.parse(output(jsonCapture.stdout)) as { candidates: unknown[] };
    expect(parsed.candidates.length).toBe(1);
  });
});

describe("handoff", () => {
  it("renders an empty store honestly", async () => {
    const { stdout } = captureOutput();
    expect(await run(["handoff", "--store", freshStore()])).toBe(0);
    const text = output(stdout);
    expect(text).toContain("agent handoff");
    expect(text).toContain("latest run: none");
    expect(text).toContain("AGENTS.md");
  });

  it("carries narrative state and protocol reminders for a seeded store", async () => {
    const store = freshStore();
    const record = groupingRecord("run-1");
    writeGrouping(join(store, "run-1"), record);
    applyGrouping(store, record);
    writeSnapshot(store, {
      schemaVersion: "0.1",
      runId: "run-1",
      createdAt: "2026-08-27T12:00:00.000Z",
      connectors: [],
      documents: [],
    });
    const { stdout } = captureOutput();
    expect(await run(["handoff", "--store", store])).toBe(0);
    const text = output(stdout);
    expect(text).toContain("latest run: run-1 (grouping: yes");
    expect(text).toContain("n0001");
    expect(text).toContain("no score yet");
    expect(text).toContain("never fabricated");
  });

  it("emits the handoff state as JSON with --json", async () => {
    const store = freshStore();
    applyGrouping(store, groupingRecord("run-1"));
    const { stdout } = captureOutput();
    expect(await run(["handoff", "--store", store, "--json"])).toBe(0);
    const parsed = JSON.parse(output(stdout)) as Record<string, unknown>;
    expect(parsed.narratives).toBe(1);
    expect(parsed.runs).toBe(0);
    expect(parsed.latestRun).toBeNull();
  });
});
