import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSnapshotPlaceholder } from "../src/index.js";

const fixturePath = fileURLToPath(new URL("./fixtures/smoke.json", import.meta.url));
const fixture: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("fixture smoke test", () => {
  it("accepts the bundled snapshot fixture", () => {
    expect(isSnapshotPlaceholder(fixture)).toBe(true);
  });

  it("rejects values that are not snapshot placeholders", () => {
    expect(isSnapshotPlaceholder(null)).toBe(false);
    expect(isSnapshotPlaceholder("snapshot")).toBe(false);
    expect(isSnapshotPlaceholder({ schemaVersion: 2, scanId: "smoke-0001" })).toBe(false);
    expect(isSnapshotPlaceholder({ schemaVersion: 1, scanId: "" })).toBe(false);
    expect(isSnapshotPlaceholder({ schemaVersion: 1 })).toBe(false);
  });
});
