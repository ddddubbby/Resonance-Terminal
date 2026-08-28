import { describe, expect, it } from "vitest";
import {
  BinanceSpotConnector,
  CoinbaseSpotConnector,
  DEFAULT_MAX_RESPONSE_BYTES,
  FeedConnector,
  type FetchFn,
  marketConnectors,
  type RawCapture,
  toConnectorResult,
} from "../src/index.js";

function jsonResponse(status: number, body: unknown): FetchFn {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }) as Response;
}

describe("BinanceSpotConnector", () => {
  it("records a successful fetch with payload and locked result shape", async () => {
    const tape = [{ symbol: "BTCUSDT", lastPrice: "100000.00" }];
    const connector = new BinanceSpotConnector({ fetcher: jsonResponse(200, tape) });
    const capture = await connector.fetchCapture();
    expect(capture.connectorId).toBe("binance-spot");
    expect(capture.url).toBe(BinanceSpotConnector.url);
    expect(capture.ok).toBe(true);
    expect(capture.status).toBe(200);
    expect(capture.payload).toEqual(tape);
    expect(new Date(capture.fetchedAt).toISOString()).toBe(capture.fetchedAt);

    const result = await new BinanceSpotConnector({ fetcher: jsonResponse(200, tape) }).fetch();
    expect(result).toMatchObject({
      connectorId: "binance-spot",
      kind: "market",
      ok: true,
      status: 200,
    });
    expect(result.error).toBeUndefined();
  });

  it("records HTTP failures without throwing", async () => {
    const connector = new BinanceSpotConnector({ fetcher: jsonResponse(429, {}) });
    const capture = await connector.fetchCapture();
    expect(capture.ok).toBe(false);
    expect(capture.status).toBe(429);
    expect(capture.error).toBe("HTTP 429");
    expect(capture.payload).toBeUndefined();
  });

  it("records network errors without throwing", async () => {
    const fetcher: FetchFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const capture = await new BinanceSpotConnector({ fetcher }).fetchCapture();
    expect(capture.ok).toBe(false);
    expect(capture.status).toBeUndefined();
    expect(capture.error).toBe("ECONNREFUSED");
  });
});

describe("CoinbaseSpotConnector", () => {
  it("fetches the products endpoint and reports the locked shape", async () => {
    const products = [{ id: "BTC-USD", price: "100000" }];
    const connector = new CoinbaseSpotConnector({ fetcher: jsonResponse(200, products) });
    const capture = await connector.fetchCapture();
    expect(capture.url).toBe(CoinbaseSpotConnector.url);
    expect(capture.payload).toEqual(products);
    const result = await connector.fetch();
    expect(result).toMatchObject({ connectorId: "coinbase-spot", kind: "market", ok: true });
  });
});

describe("marketConnectors", () => {
  it("ships Binance and Coinbase in stable order", () => {
    const connectors = marketConnectors();
    expect(connectors.map((c) => c.id)).toEqual(["binance-spot", "coinbase-spot"]);
    expect(connectors.every((c) => c.kind === "market")).toBe(true);
  });
});

describe("toConnectorResult", () => {
  it("omits status and error when absent", () => {
    const capture: RawCapture = {
      connectorId: "binance-spot",
      url: "https://example.invalid",
      ok: false,
      fetchedAt: "2026-08-24T00:00:00.000Z",
      error: "boom",
    };
    const result = toConnectorResult(capture, "market");
    expect(result).toEqual({
      connectorId: "binance-spot",
      kind: "market",
      ok: false,
      error: "boom",
      capturedAt: "2026-08-24T00:00:00.000Z",
    });
    expect("status" in result).toBe(false);
  });
});

describe("response body budget", () => {
  function byteResponse(bytes: number, contentLength?: string): FetchFn {
    return async () =>
      new Response(new Uint8Array(bytes).fill(97), {
        status: 200,
        headers: contentLength === undefined ? {} : { "content-length": contentLength },
      });
  }

  it("defaults to the shared 16 MiB budget", () => {
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(16 * 1024 * 1024);
  });

  it("accepts a body at exactly the limit", async () => {
    const connector = new FeedConnector("rss-test", "https://example.invalid/feed.xml", {
      fetcher: byteResponse(8),
      maxResponseBytes: 8,
    });
    const capture = await connector.fetchCapture();
    expect(capture.ok).toBe(true);
    expect(capture.status).toBe(200);
    expect((capture.payload as string).length).toBe(8);
  });

  it("fails one byte over the limit while streaming (no Content-Length)", async () => {
    const connector = new FeedConnector("rss-test", "https://example.invalid/feed.xml", {
      fetcher: byteResponse(9),
      maxResponseBytes: 8,
    });
    const capture = await connector.fetchCapture();
    expect(capture.ok).toBe(false);
    expect(capture.status).toBe(200);
    expect(capture.payload).toBeUndefined();
    expect(capture.error).toContain("byte limit");
  });

  it("fails fast on a declared Content-Length above the limit", async () => {
    const connector = new FeedConnector("rss-test", "https://example.invalid/feed.xml", {
      fetcher: byteResponse(32, "32"),
      maxResponseBytes: 8,
    });
    const capture = await connector.fetchCapture();
    expect(capture.ok).toBe(false);
    expect(capture.error).toContain("declared");
  });

  it("enforces the limit on the stream when Content-Length lies low", async () => {
    const connector = new FeedConnector("rss-test", "https://example.invalid/feed.xml", {
      fetcher: byteResponse(9, "4"),
      maxResponseBytes: 8,
    });
    const capture = await connector.fetchCapture();
    expect(capture.ok).toBe(false);
    expect(capture.error).toContain("byte limit");
  });

  it("rejects invalid limit configuration before requesting", async () => {
    for (const bad of [0, -1, 1.5]) {
      const connector = new FeedConnector("rss-test", "https://example.invalid/feed.xml", {
        fetcher: byteResponse(4),
        maxResponseBytes: bad,
      });
      await expect(connector.fetchCapture()).rejects.toThrow("positive integer");
    }
  });

  it("records invalid JSON at HTTP 200 as a failure and preserves status", async () => {
    const fetcher: FetchFn = async () =>
      new Response("not-json{", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const capture = await new BinanceSpotConnector({ fetcher }).fetchCapture();
    expect(capture.ok).toBe(false);
    expect(capture.status).toBe(200);
    expect(capture.payload).toBeUndefined();
    expect(capture.error).toBeDefined();
  });
});
