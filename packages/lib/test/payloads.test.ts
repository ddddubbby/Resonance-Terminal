import { describe, expect, it } from "vitest";
import type { RawCapture } from "../src/connectors.js";
import {
  enforcePayloadValidity,
  validateBinancePayload,
  validateCapturePayload,
  validateCoinbasePayload,
  validateDefiLlamaPayload,
  validateFeedPayload,
  validateGitHubPayload,
} from "../src/index.js";

const binanceRow = {
  symbol: "BTCUSDT",
  lastPrice: "100000.00",
  priceChangePercent: "1.23",
  quoteVolume: "900000000",
};

describe("family payload validators", () => {
  it("validates Binance ticker rows", () => {
    expect(validateBinancePayload([binanceRow])).toBeUndefined();
    expect(validateBinancePayload([{ symbol: "BTCUSDT" }])).toContain("lastPrice");
    expect(validateBinancePayload({ symbol: "BTCUSDT" })).toContain("not a JSON array");
    expect(validateBinancePayload(["BTCUSDT"])).toContain("not an object");
  });

  it("validates Coinbase product rows", () => {
    expect(validateCoinbasePayload([{ id: "BTC-USD", price: "100000" }])).toBeUndefined();
    expect(validateCoinbasePayload([{ price: "100000" }])).toContain('"id"');
  });

  it("validates DefiLlama protocol rows", () => {
    expect(validateDefiLlamaPayload([{ name: "Aave", tvl: 12345 }])).toBeUndefined();
    expect(validateDefiLlamaPayload([{ tvl: 12345 }])).toContain('"name"');
  });

  it("validates feed body text", () => {
    expect(validateFeedPayload("<rss><channel></channel></rss>")).toBeUndefined();
    expect(validateFeedPayload("   ")).toContain("empty");
    expect(validateFeedPayload(["<rss/>"])).toContain("not body text");
  });

  it("validates GitHub release objects", () => {
    expect(validateGitHubPayload({ tag_name: "v1.0.0" })).toBeUndefined();
    expect(validateGitHubPayload({ name: "v1.0.0" })).toContain('"tag_name"');
    expect(validateGitHubPayload([{ tag_name: "v1.0.0" }])).toContain("not a JSON object");
  });

  it("dispatches by fixed connector id and passes unknown ids through", () => {
    expect(
      validateCapturePayload({
        connectorId: "binance-spot",
        url: "u",
        ok: true,
        fetchedAt: "t",
        payload: [binanceRow],
      }),
    ).toBeUndefined();
    expect(
      validateCapturePayload({
        connectorId: "rss-coindesk",
        url: "u",
        ok: true,
        fetchedAt: "t",
        payload: "",
      }),
    ).toContain("empty");
    expect(
      validateCapturePayload({
        connectorId: "github-client-typescript",
        url: "u",
        ok: true,
        fetchedAt: "t",
        payload: {},
      }),
    ).toContain('"tag_name"');
    expect(
      validateCapturePayload({
        connectorId: "custom-fake",
        url: "u",
        ok: true,
        fetchedAt: "t",
        payload: 42,
      }),
    ).toBeUndefined();
  });
});

describe("enforcePayloadValidity", () => {
  const base: RawCapture = {
    connectorId: "coinbase-spot",
    url: "https://api.exchange.coinbase.com/products",
    ok: true,
    status: 200,
    fetchedAt: "2026-08-28T03:00:00.000Z",
    payload: [{ price: "100000" }],
  };

  it("turns a malformed HTTP-200 capture into a recorded failure without payload", () => {
    const enforced = enforcePayloadValidity(base);
    expect(enforced.ok).toBe(false);
    expect(enforced.status).toBe(200);
    expect(enforced.url).toBe(base.url);
    expect(enforced.fetchedAt).toBe(base.fetchedAt);
    expect(enforced.payload).toBeUndefined();
    expect(enforced.error).toContain("invalid payload");
  });

  it("leaves valid and failed captures untouched", () => {
    const valid = { ...base, payload: [{ id: "BTC-USD" }] };
    expect(enforcePayloadValidity(valid)).toBe(valid);
    const failed: RawCapture = { ...base, ok: false, error: "HTTP 500", payload: undefined };
    expect(enforcePayloadValidity(failed)).toBe(failed);
  });
});
