/**
 * Scan orchestration: fetch -> normalize -> snapshot -> cluster.
 *
 * One scan produces one immutable snapshot plus the run-local derived
 * artifacts (raw captures, cluster view) under the store layout used by
 * docs/PROTOCOL.md. The grouping, observation, evidence, and scoring steps
 * are deliberately not part of a scan: grouping is agent-side
 * interpretation, and everything after it consumes what a scan wrote.
 *
 * Exit semantics (the locked contract): `degraded` is true when at least
 * one connector failed but the snapshot was still written (EXIT_DEGRADED);
 * a scan that produced no documents at all is an error (EXIT_ERROR).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeCapture } from "./captures.js";
import {
  CLUSTERING_ARTIFACT_VERSION,
  type ClusterArtifact,
  clusterDocuments,
  DEFAULT_CLUSTERING_CONFIG,
  writeClusters,
} from "./clustering.js";
import {
  type CapturingConnector,
  marketConnectors,
  type RawCapture,
  toConnectorResult,
} from "./connectors.js";
import type { ConnectorResult } from "./index.js";
import { listSnapshots, SNAPSHOT_SCHEMA_VERSION, type Snapshot, writeSnapshot } from "./index.js";
import { normalizeCaptures } from "./normalize.js";
import { researchConnectors } from "./research-connectors.js";

/**
 * The run directory of one scan inside a store. The snapshot store writes
 * snapshots to `<storeDir>/<runId>/snapshot.json`, so the run directory IS
 * the snapshot directory: raw captures, clustering, grouping, and evidence
 * for a run all live beside its snapshot.
 */
export function runDirOf(storeDir: string, runId: string): string {
  return join(storeDir, runId);
}

/** The runId of a scan started at the given time (UTC, locked pattern). */
export function runIdAt(date: Date): string {
  return date.toISOString().slice(0, 19).replaceAll(":", "-");
}

/** All run ids of a store, oldest first (the snapshot layout). */
export function listRuns(storeDir: string): string[] {
  return listSnapshots(storeDir);
}

/** Outcome of one scan. */
export interface ScanSummary {
  readonly runId: string;
  readonly runDir: string;
  readonly connectors: readonly ConnectorResult[];
  readonly documents: number;
  readonly clusters: number;
  /** True when some connectors failed but the snapshot was written. */
  readonly degraded: boolean;
}

/** Options for {@link runScan}; connectors and clock are injectable. */
export interface ScanOptions {
  /** Defaults to the fixed market + research connector families. */
  readonly connectors?: readonly CapturingConnector[];
  /** Injectable clock; defaults to the system clock. */
  readonly now?: () => Date;
}

/**
 * Execute one scan against a store: fetch every connector (recording raw
 * captures), normalize the payloads into locked documents, write the
 * immutable snapshot, and persist the run-local cluster view. Throws when
 * the normalization produced no documents at all.
 */
export async function runScan(storeDir: string, options: ScanOptions = {}): Promise<ScanSummary> {
  const connectors = options.connectors ?? [...marketConnectors(), ...researchConnectors()];
  const start = (options.now ?? (() => new Date()))();
  const runId = runIdAt(start);
  const runDir = runDirOf(storeDir, runId);
  mkdirSync(runDir, { recursive: true });

  const captures: RawCapture[] = [];
  const results: ConnectorResult[] = [];
  for (const connector of connectors) {
    const capture = await connector.fetchCapture();
    writeCapture(runDir, capture);
    captures.push(capture);
    results.push(toConnectorResult(capture, connector.kind));
  }

  const documents = normalizeCaptures(captures);
  if (documents.length === 0) {
    throw new Error(
      `scan ${runId} produced no documents; check the raw captures in ${join(runDir, "raw")}`,
    );
  }
  const snapshot: Snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    runId,
    createdAt: start.toISOString(),
    connectors: results,
    documents,
  };
  writeSnapshot(storeDir, snapshot);

  const clusters = clusterDocuments(documents, DEFAULT_CLUSTERING_CONFIG);
  const artifact: ClusterArtifact = {
    schemaVersion: CLUSTERING_ARTIFACT_VERSION,
    runId,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    config: DEFAULT_CLUSTERING_CONFIG,
    clusters,
  };
  writeClusters(runDir, artifact);

  const failed = results.filter((result) => !result.ok).length;
  return {
    runId,
    runDir,
    connectors: results,
    documents: documents.length,
    clusters: clusters.length,
    degraded: failed > 0,
  };
}
