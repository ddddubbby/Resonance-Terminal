import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CapturingConnector, RawCapture } from "../src/connectors.js";
import type { ConnectorResult } from "../src/index.js";
import { listRuns, runIdAt, runScan } from "../src/scan.js";

const tmpDirs: string[] = [];
function freshStore(): string {
  const dir = mkdtempSync(join(tmpdir(), "resonance-scan-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

class FakeConnector implements CapturingConnector {
  readonly kind = "market" as const;
  constructor(
    readonly id: string,
    private readonly capture: RawCapture,
  ) {}
  async fetchCapture(): Promise<RawCapture> {
    return this.capture;
  }
  async fetch(): Promise<ConnectorResult> {
    return {
      connectorId: this.id,
      kind: this.kind,
      ok: this.capture.ok,
      capturedAt: this.capture.fetchedAt,
    };
  }
}

const FIXED_NOW = () => new Date("2026-08-27T12:00:00.000Z");

const goodCapture: RawCapture = {
  connectorId: "binance-spot",
  url: "https://example.com/binance",
  ok: true,
  fetchedAt: "2026-08-27T12:00:00.000Z",
  payload: [
    {
      symbol: "BTCUSDT",
      lastPrice: "77000",
      priceChangePercent: "0.5",
      quoteVolume: "1000000000",
      count: 100,
    },
  ],
};

const badCapture: RawCapture = {
  connectorId: "rss-coindesk",
  url: "https://example.com/feed",
  ok: false,
  fetchedAt: "2026-08-27T12:00:00.000Z",
  error: "HTTP 503",
};

describe("runIdAt and listRuns", () => {
  it("derives locked-pattern run ids from timestamps", () => {
    expect(runIdAt(new Date("2026-08-27T12:34:56.789Z"))).toBe("2026-08-27T12-34-56");
  });

  it("lists no runs for a fresh store", () => {
    expect(listRuns(freshStore())).toEqual([]);
  });
});

describe("runScan", () => {
  it("writes captures, snapshot, and clusters for a clean scan", async () => {
    const store = freshStore();
    const summary = await runScan(store, {
      connectors: [new FakeConnector("binance-spot", goodCapture)],
      now: FIXED_NOW,
    });
    expect(summary.runId).toBe("2026-08-27T12-00-00");
    expect(summary.degraded).toBe(false);
    expect(summary.documents).toBeGreaterThan(0);
    expect(summary.connectors.length).toBe(1);
    expect(existsSync(join(store, summary.runId, "snapshot.json"))).toBe(true);
    expect(existsSync(join(summary.runDir, "raw", "binance-spot.json"))).toBe(true);
    expect(existsSync(join(summary.runDir, "clusters.json"))).toBe(true);
    const snapshot = JSON.parse(
      readFileSync(join(store, summary.runId, "snapshot.json"), "utf8"),
    ) as { schemaVersion: string; documents: unknown[] };
    expect(snapshot.schemaVersion).toBe("0.1");
    expect(snapshot.documents.length).toBe(summary.documents);
    expect(listRuns(store)).toEqual([summary.runId]);
  });

  it("marks the scan degraded when a connector fails but docs remain", async () => {
    const store = freshStore();
    const summary = await runScan(store, {
      connectors: [
        new FakeConnector("binance-spot", goodCapture),
        new FakeConnector("rss-coindesk", badCapture),
      ],
      now: FIXED_NOW,
    });
    expect(summary.degraded).toBe(true);
    expect(summary.connectors.some((c) => !c.ok)).toBe(true);
    expect(existsSync(join(store, summary.runId, "snapshot.json"))).toBe(true);
  });

  it("throws when normalization produces no documents", async () => {
    const store = freshStore();
    await expect(
      runScan(store, {
        connectors: [new FakeConnector("rss-coindesk", badCapture)],
        now: FIXED_NOW,
      }),
    ).rejects.toThrow("produced no documents");
  });
});
