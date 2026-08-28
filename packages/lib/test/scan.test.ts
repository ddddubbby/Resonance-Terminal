import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCapture } from "../src/captures.js";
import type { CapturingConnector, RawCapture } from "../src/connectors.js";
import type { ConnectorResult } from "../src/index.js";
import { listRuns, runDirOf, runIdAt, runScan } from "../src/scan.js";

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

describe("runDirOf", () => {
  it("resolves valid run ids inside the store", () => {
    expect(runDirOf("/tmp/store", "2026-08-27T12-00-00")).toBe(
      join("/tmp/store", "2026-08-27T12-00-00"),
    );
  });

  it("rejects traversal-shaped run ids", () => {
    for (const bad of ["../evil", "..", "/etc/passwd", "run/1", "a\\b", "", " "]) {
      expect(() => runDirOf("/tmp/store", bad)).toThrow(/runId/);
    }
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

  it("records a malformed HTTP-200 payload as a failure and stays degraded", async () => {
    const store = freshStore();
    const malformedBinance: RawCapture = {
      ...goodCapture,
      status: 200,
      payload: [{ symbol: "BTCUSDT" }], // ticker rows miss the required fields
    };
    const validFeed: RawCapture = {
      connectorId: "rss-test",
      url: "https://example.com/feed.xml",
      ok: true,
      fetchedAt: "2026-08-27T12:00:00.000Z",
      payload: `<rss><channel><item>
        <title>Stablecoin payments grow</title>
        <link>https://example.com/story</link>
        <pubDate>Mon, 01 Jun 2026 08:00:00 GMT</pubDate>
        <description>Details of the story.</description>
      </item></channel></rss>`,
    };
    const summary = await runScan(store, {
      connectors: [
        new FakeConnector("binance-spot", malformedBinance),
        new FakeConnector("rss-test", validFeed),
      ],
      now: FIXED_NOW,
    });
    // The snapshot was written from the valid connector's documents.
    expect(existsSync(join(store, summary.runId, "snapshot.json"))).toBe(true);
    expect(summary.documents).toBeGreaterThan(0);
    expect(summary.degraded).toBe(true);
    const binance = summary.connectors.find((c) => c.connectorId === "binance-spot");
    expect(binance?.ok).toBe(false);
    expect(binance?.status).toBe(200);
    expect(binance?.error).toContain("invalid payload");
    // The persisted raw capture keeps id/url/status/time but drops the payload.
    const persisted = readCapture(summary.runDir, "binance-spot");
    expect(persisted?.ok).toBe(false);
    expect(persisted?.payload).toBeUndefined();
    expect(persisted?.error).toContain("invalid payload");
  });
});
