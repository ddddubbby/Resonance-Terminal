import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CaptureStoreError,
  capturePath,
  type RawCapture,
  readCapture,
  writeCapture,
} from "../src/index.js";

function capture(connectorId: string, payload: unknown = [{ symbol: "BTCUSDT" }]): RawCapture {
  return {
    connectorId,
    url: `https://example.invalid/${connectorId}`,
    ok: true,
    status: 200,
    fetchedAt: "2026-08-24T00:00:00.000Z",
    payload,
  };
}

function freshRunDir(): string {
  return mkdtempSync(join(tmpdir(), "resonance-run-"));
}

function expectCaptureError(fn: () => unknown, code: CaptureStoreError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CaptureStoreError);
    expect((error as CaptureStoreError).code).toBe(code);
    return;
  }
  expect.fail(`expected CaptureStoreError with code "${code}"`);
}

describe("capture persistence", () => {
  it("writes a capture under raw/ and reads it back", () => {
    const runDir = freshRunDir();
    const path = writeCapture(runDir, capture("binance-spot"));
    expect(path).toBe(capturePath(runDir, "binance-spot"));
    expect(path).toBe(join(runDir, "raw", "binance-spot.json"));
    expect(readCapture(runDir, "binance-spot")).toEqual(capture("binance-spot"));
  });

  it("persists failed fetches without a payload", () => {
    const runDir = freshRunDir();
    const failed: RawCapture = {
      connectorId: "coinbase-spot",
      url: "https://example.invalid/coinbase-spot",
      ok: false,
      status: 500,
      error: "HTTP 500",
      fetchedAt: "2026-08-24T00:00:00.000Z",
    };
    writeCapture(runDir, failed);
    expect(readCapture(runDir, "coinbase-spot")).toEqual(failed);
  });

  it("refuses to overwrite an existing capture", () => {
    const runDir = freshRunDir();
    writeCapture(runDir, capture("binance-spot"));
    expectCaptureError(() => writeCapture(runDir, capture("binance-spot")), "capture-exists");
  });

  it("rejects connectorIds that could escape the run directory", () => {
    const runDir = freshRunDir();
    expectCaptureError(() => capturePath(runDir, "../evil"), "invalid-connector-id");
    expectCaptureError(() => writeCapture(runDir, capture("a/b")), "invalid-connector-id");
  });

  it("returns null for a capture that does not exist", () => {
    expect(readCapture(freshRunDir(), "missing")).toBeNull();
  });
});
