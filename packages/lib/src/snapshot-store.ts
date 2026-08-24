/**
 * Canonical snapshot storage.
 *
 * Snapshots are the immutable, git-tracked record of a scan. Each snapshot
 * lives at `<storeDir>/<runId>/snapshot.json`, serialized deterministically
 * so git diffs stay minimal across runs. Storage rules locked here:
 *
 * - Snapshots are immutable: writing an existing runId is an error.
 * - Documents must already satisfy the deduplication contract (unique by
 *   contentHash and by `(sourceId, url)`); the store enforces it.
 * - Only the locked schema version is readable; anything else is an
 *   explicit error, never a silent coercion.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isSnapshot, SNAPSHOT_SCHEMA_VERSION, type Snapshot } from "./index.js";

/** Failure codes for snapshot store operations. */
export type SnapshotStoreErrorCode =
  | "invalid-run-id"
  | "invalid-snapshot"
  | "duplicate-documents"
  | "snapshot-exists"
  | "unsupported-schema";

/** Error thrown by snapshot store operations, with a stable `code`. */
export class SnapshotStoreError extends Error {
  readonly code: SnapshotStoreErrorCode;

  constructor(code: SnapshotStoreErrorCode, message: string) {
    super(message);
    this.name = "SnapshotStoreError";
    this.code = code;
  }
}

/** RunIds are timestamp slugs; this shape also keeps paths traversal-safe. */
const RUN_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;

/** Name of the snapshot file inside a run directory. */
export const SNAPSHOT_FILE = "snapshot.json";

function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new SnapshotStoreError(
      "invalid-run-id",
      `runId must match ${RUN_ID_PATTERN} (got "${runId}")`,
    );
  }
}

/** Deep-sort object keys so serialization is deterministic for git. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Serialize a snapshot deterministically (sorted keys, trailing newline). */
export function serializeSnapshot(snapshot: Snapshot): string {
  return `${JSON.stringify(canonicalize(snapshot), null, 2)}\n`;
}

/** Verify the locked deduplication invariants over snapshot documents. */
function assertDedupInvariants(snapshot: Snapshot): void {
  const seenHashes = new Set<string>();
  const seenUrls = new Set<string>();
  for (const doc of snapshot.documents) {
    if (seenHashes.has(doc.contentHash)) {
      throw new SnapshotStoreError(
        "duplicate-documents",
        `duplicate contentHash ${doc.contentHash} in snapshot ${snapshot.runId}`,
      );
    }
    const urlKey = `${doc.sourceId}|${doc.url}`;
    if (seenUrls.has(urlKey)) {
      throw new SnapshotStoreError(
        "duplicate-documents",
        `duplicate (sourceId, url) pair ${urlKey} in snapshot ${snapshot.runId}`,
      );
    }
    seenHashes.add(doc.contentHash);
    seenUrls.add(urlKey);
  }
}

/**
 * Write an immutable snapshot to `<storeDir>/<runId>/snapshot.json`.
 * Accepts `unknown` and validates the schema and dedup invariants at the
 * boundary; refuses to overwrite.
 */
export function writeSnapshot(storeDir: string, candidate: unknown): string {
  if (!isSnapshot(candidate)) {
    throw new SnapshotStoreError(
      "invalid-snapshot",
      `candidate snapshot violates schema ${SNAPSHOT_SCHEMA_VERSION}`,
    );
  }
  const snapshot = candidate;
  assertRunId(snapshot.runId);
  assertDedupInvariants(snapshot);
  const runDir = join(storeDir, snapshot.runId);
  const path = join(runDir, SNAPSHOT_FILE);
  if (existsSync(path)) {
    throw new SnapshotStoreError(
      "snapshot-exists",
      `snapshot ${snapshot.runId} already exists and is immutable`,
    );
  }
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path, serializeSnapshot(snapshot), "utf8");
  return path;
}

/**
 * Read and validate a snapshot. Returns `null` when the run does not exist;
 * throws on parse failures or unsupported schema versions.
 */
export function readSnapshot(storeDir: string, runId: string): Snapshot | null {
  assertRunId(runId);
  const path = join(storeDir, runId, SNAPSHOT_FILE);
  if (!existsSync(path)) {
    return null;
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new SnapshotStoreError("invalid-snapshot", `snapshot ${runId} is not an object`);
  }
  const version = (parsed as Record<string, unknown>).schemaVersion;
  if (version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotStoreError(
      "unsupported-schema",
      `snapshot ${runId} has schema version ${JSON.stringify(version)}; expected ${SNAPSHOT_SCHEMA_VERSION}`,
    );
  }
  if (!isSnapshot(parsed)) {
    throw new SnapshotStoreError(
      "invalid-snapshot",
      `snapshot ${runId} violates schema ${SNAPSHOT_SCHEMA_VERSION}`,
    );
  }
  return parsed;
}

/** List stored runIds in ascending (chronological, slug-sortable) order. */
export function listSnapshots(storeDir: string): string[] {
  if (!existsSync(storeDir)) {
    return [];
  }
  return readdirSync(storeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((runId) => RUN_ID_PATTERN.test(runId))
    .filter((runId) => existsSync(join(storeDir, runId, SNAPSHOT_FILE)))
    .sort();
}

/** Resolve a store directory against the current working directory. */
export function resolveStoreDir(storeDir: string): string {
  return resolve(storeDir);
}
