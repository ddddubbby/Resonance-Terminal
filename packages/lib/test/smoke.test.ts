import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSnapshot } from "../src/index.js";

const fixturePath = fileURLToPath(new URL("./fixtures/smoke.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

describe("snapshot fixture smoke test", () => {
  it("accepts the bundled snapshot fixture", () => {
    expect(isSnapshot(fixture)).toBe(true);
  });

  it("rejects values that violate the locked snapshot schema", () => {
    expect(isSnapshot(null)).toBe(false);
    expect(isSnapshot("snapshot")).toBe(false);
    expect(isSnapshot({ ...fixture, schemaVersion: 1 })).toBe(false);
    expect(isSnapshot({ ...fixture, runId: "" })).toBe(false);
    expect(isSnapshot({ ...fixture, connectors: "binance" })).toBe(false);
    expect(isSnapshot({ ...fixture, documents: [] })).toBe(true);
    const [doc] = (fixture as { documents: unknown[] }).documents;
    expect(
      isSnapshot({ ...fixture, documents: [{ ...(doc as object), docId: "54e2d38ecbd" }] }),
    ).toBe(false);
    expect(isSnapshot({ ...fixture, documents: [{ ...(doc as object), kind: "rumor" }] })).toBe(
      false,
    );
  });
});
