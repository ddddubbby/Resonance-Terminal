import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listSnapshots,
  makeDocument,
  readSnapshot,
  SNAPSHOT_FILE,
  type Snapshot,
  SnapshotStoreError,
  type SnapshotStoreErrorCode,
  serializeSnapshot,
  writeSnapshot,
} from "../src/index.js";

const CAPTURED_AT = "2026-08-24T00:00:00Z";

function expectStoreError(fn: () => unknown, code: SnapshotStoreErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SnapshotStoreError);
    expect((error as SnapshotStoreError).code).toBe(code);
    return;
  }
  expect.fail(`expected SnapshotStoreError with code "${code}"`);
}

function doc(url: string, text: string, sourceId = "binance-spot") {
  return makeDocument({ sourceId, kind: "market" as const, url, title: text, text }, CAPTURED_AT);
}

function snapshot(
  runId: string,
  documents = [doc("https://example.invalid/a", "alpha")],
): Snapshot {
  return {
    schemaVersion: "0.1",
    runId,
    createdAt: CAPTURED_AT,
    connectors: [
      {
        connectorId: "binance-spot",
        kind: "market",
        ok: true,
        status: 200,
        capturedAt: CAPTURED_AT,
      },
    ],
    documents,
  };
}

function freshStore(): string {
  return mkdtempSync(join(tmpdir(), "resonance-snapshots-"));
}

describe("snapshot storage", () => {
  it("roundtrips a snapshot through write and read", () => {
    const store = freshStore();
    const snap = snapshot("2026-08-24T00-00-00");
    const path = writeSnapshot(store, snap);
    expect(path).toBe(join(store, "2026-08-24T00-00-00", SNAPSHOT_FILE));
    expect(readSnapshot(store, "2026-08-24T00-00-00")).toEqual(snap);
  });

  it("serializes deterministically with sorted keys", () => {
    const snap = snapshot("2026-08-24T00-00-00");
    const first = serializeSnapshot(snap);
    expect(first.endsWith("\n")).toBe(true);
    expect(first).toBe(serializeSnapshot(snap));
    expect(first.indexOf('"connectors"')).toBeLessThan(first.indexOf('"documents"'));
    expect(first.indexOf('"createdAt"')).toBeLessThan(first.indexOf('"documents"'));
  });

  it("refuses to overwrite an existing snapshot", () => {
    const store = freshStore();
    writeSnapshot(store, snapshot("run-a"));
    expectStoreError(() => writeSnapshot(store, snapshot("run-a")), "snapshot-exists");
  });

  it("returns null for a run that does not exist", () => {
    expect(readSnapshot(freshStore(), "missing-run")).toBeNull();
  });

  it("lists stored runs in ascending order and ignores incomplete entries", () => {
    const store = freshStore();
    writeSnapshot(store, snapshot("2026-08-24T01-00-00"));
    writeSnapshot(store, snapshot("2026-08-23T23-00-00"));
    mkdirSync(join(store, "2026-08-25T00-00-00"), { recursive: true });
    writeFileSync(join(store, "not-a-run.txt"), "noise", "utf8");
    expect(listSnapshots(store)).toEqual(["2026-08-23T23-00-00", "2026-08-24T01-00-00"]);
    expect(listSnapshots(join(store, "does-not-exist"))).toEqual([]);
  });
});

describe("snapshot store validation", () => {
  it("enforces the deduplication contract on write", () => {
    const store = freshStore();
    const docA = doc("https://example.invalid/a", "alpha");
    const duplicateHash = { ...docA };
    expectStoreError(
      () => writeSnapshot(store, snapshot("dup-hash", [docA, duplicateHash])),
      "duplicate-documents",
    );
    const urlCollision = doc("https://example.invalid/a", "different content");
    expectStoreError(
      () => writeSnapshot(store, snapshot("dup-url", [docA, urlCollision])),
      "duplicate-documents",
    );
  });

  it("rejects runIds that could escape the store directory", () => {
    const store = freshStore();
    expectStoreError(() => writeSnapshot(store, snapshot("../evil")), "invalid-run-id");
    expectStoreError(() => readSnapshot(store, "a/b"), "invalid-run-id");
  });

  it("rejects snapshots that violate the locked schema", () => {
    const store = freshStore();
    const bad = snapshot("bad-doc") as unknown as Record<string, unknown>;
    bad.documents = [{ ...(bad.documents as object[])[0], docId: "54e2d38ecbd" }];
    expectStoreError(() => writeSnapshot(store, bad as unknown as Snapshot), "invalid-snapshot");
  });

  it("reads only the locked schema version", () => {
    const store = freshStore();
    writeSnapshot(store, snapshot("versioned"));
    const path = join(store, "versioned", SNAPSHOT_FILE);
    const future: unknown = { ...snapshot("versioned"), schemaVersion: "0.2" };
    writeFileSync(path, JSON.stringify(future), "utf8");
    expectStoreError(() => readSnapshot(store, "versioned"), "unsupported-schema");
  });
});

describe("SnapshotStoreError", () => {
  it("carries a stable code and name", () => {
    const error = new SnapshotStoreError("snapshot-exists", "boom");
    expect(error.code).toBe("snapshot-exists");
    expect(error.name).toBe("SnapshotStoreError");
    expect(error).toBeInstanceOf(Error);
  });
});
