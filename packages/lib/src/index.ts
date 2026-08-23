/**
 * Placeholder contracts for Resonance Terminal.
 *
 * These interfaces are intentionally minimal. The stable connector and
 * snapshot contracts are formalized on the `refactor/alpha-contracts`
 * branch after `spike/ten-real-candidates` proves what is necessary.
 * Do not build further infrastructure on these types yet.
 */

/** Identifier of a public-data connector. */
export type ConnectorId = string;

/** Marker interface for a connector implementation. Placeholder shape. */
export interface ConnectorPlaceholder {
  readonly id: ConnectorId;
}

/** Marker interface for an immutable scan snapshot. Placeholder shape. */
export interface SnapshotPlaceholder {
  readonly schemaVersion: 1;
  readonly scanId: string;
}

/**
 * Narrow an unknown parsed value to {@link SnapshotPlaceholder}.
 *
 * Used by the bootstrap fixture smoke test until real snapshot parsing
 * lands on `feat/canonical-snapshots`.
 */
export function isSnapshotPlaceholder(value: unknown): value is SnapshotPlaceholder {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 && typeof record.scanId === "string" && record.scanId.length > 0
  );
}
