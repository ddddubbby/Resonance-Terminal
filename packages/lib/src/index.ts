/**
 * Stable alpha contracts for Resonance Terminal.
 *
 * Locked on `refactor/alpha-contracts` from what `spike/ten-real-candidates`
 * proved on live data, and recorded in docs/DESIGN.md. No implementation
 * branch may redefine these contracts without a separately approved
 * directional PR.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Scan lifecycle
// ---------------------------------------------------------------------------

/**
 * The five scan lifecycle stages, in execution order. Every scan runs all
 * five; partial runs are contract violations, not degraded scans.
 */
export const SCAN_LIFECYCLE = ["fetch", "normalize", "cluster", "evidence", "candidates"] as const;

/** One stage of {@link SCAN_LIFECYCLE}. */
export type ScanStage = (typeof SCAN_LIFECYCLE)[number];

// ---------------------------------------------------------------------------
// CLI exit codes
// ---------------------------------------------------------------------------

/** Success. Tolerated source failures never fail a run; they are recorded. */
export const EXIT_OK = 0;

/**
 * Hard error: invalid CLI usage, contract violation, or a fatal pipeline
 * failure (a lifecycle stage could not complete).
 */
export const EXIT_ERROR = 1;

/** Degraded success: the run completed but recorded at least one source failure. */
export const EXIT_DEGRADED = 2;

/** A process exit code defined by the contract. */
export type ExitCode = typeof EXIT_OK | typeof EXIT_ERROR | typeof EXIT_DEGRADED;

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

/** Identifier of a public-data connector, unique within a snapshot. */
export type ConnectorId = string;

/**
 * Source family of a connector. The five fixed milestone connectors map to
 * `market` (Binance, Coinbase), `tvl` (DefiLlama), `feed` (RSS/Atom), and
 * `repo` (GitHub); `positioning` and `stablecoin` cover the alpha-shaped
 * sources proven by the spike.
 */
export type SourceKind = "market" | "tvl" | "feed" | "repo" | "positioning" | "stablecoin";

/** Outcome of one connector fetch, recorded in the snapshot. */
export interface ConnectorResult {
  readonly connectorId: ConnectorId;
  readonly kind: SourceKind;
  readonly ok: boolean;
  /** HTTP status when the transport exposes one. */
  readonly status?: number;
  /** Present exactly when `ok` is false. */
  readonly error?: string;
  /** ISO-8601 timestamp of the fetch. */
  readonly capturedAt: string;
}

/**
 * A public-data connector. Implementations fetch raw payloads and report a
 * {@link ConnectorResult}; persisting raw captures belongs to the snapshot
 * layer, not to the connector.
 */
export interface Connector {
  readonly id: ConnectorId;
  readonly kind: SourceKind;
  fetch(): Promise<ConnectorResult>;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Normalized document kinds proven by the spike. The spike's
 * `hyperliquid`/`hyperliquid-spot` kinds generalize to
 * `positioning`/`positioning-spot`.
 */
export const DOCUMENT_KINDS = [
  "news",
  "release",
  "market",
  "mover",
  "tvl",
  "positioning",
  "positioning-spot",
  "stablecoin",
] as const;

/** One of {@link DOCUMENT_KINDS}. */
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * A normalized source document. Identity is the `contentHash`; `docId` is
 * its stable short form used in evidence references.
 */
export interface SourceDocument {
  /** First 12 hex characters of {@link contentHash}. */
  readonly docId: string;
  /** SHA-256 hex of `${sourceId}|${kind}|${url}|${title}|${text}`. */
  readonly contentHash: string;
  readonly sourceId: ConnectorId;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly text: string;
  /** Unique per document; producers must not share URLs across documents. */
  readonly url: string;
  /** ISO-8601 timestamp from the source, when it exposes one. */
  readonly publishedAt?: string;
  /** ISO-8601 timestamp of capture. */
  readonly capturedAt: string;
  /** Asset identity token (e.g. `BTC`, `HYPE`) when the document has one. */
  readonly asset?: string;
}

/** Input shape accepted by {@link contentHashOf} and {@link makeDocument}. */
export interface DocumentInput {
  readonly sourceId: ConnectorId;
  readonly kind: DocumentKind;
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

/** The locked content-hash formula. */
export function contentHashOf(doc: DocumentInput): string {
  const payload = [doc.sourceId, doc.kind, doc.url, doc.title, doc.text].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

/** The locked docId derivation: the first 12 hex characters. */
export function docIdOf(contentHash: string): string {
  return contentHash.slice(0, 12);
}

/** Build a {@link SourceDocument} from its inputs, deriving identity fields. */
export function makeDocument(
  input: DocumentInput,
  capturedAt: string,
  extras: { readonly publishedAt?: string; readonly asset?: string } = {},
): SourceDocument {
  const contentHash = contentHashOf(input);
  return {
    ...input,
    docId: docIdOf(contentHash),
    contentHash,
    capturedAt,
    ...extras,
  };
}

/**
 * Locked deduplication rules. Documents are unique by `contentHash`, and
 * additionally first-write-wins on `(sourceId, url)` collisions — producers
 * must give every document a distinct URL (the spike's Hyperliquid bug).
 * Input order decides which duplicate survives.
 */
export function dedupeDocuments(docs: readonly SourceDocument[]): SourceDocument[] {
  const seenHashes = new Set<string>();
  const seenUrls = new Set<string>();
  const kept: SourceDocument[] = [];
  for (const doc of docs) {
    const urlKey = `${doc.sourceId}|${doc.url}`;
    if (seenHashes.has(doc.contentHash) || seenUrls.has(urlKey)) {
      continue;
    }
    seenHashes.add(doc.contentHash);
    seenUrls.add(urlKey);
    kept.push(doc);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** Locked snapshot schema version. Bumped by an approved directional PR only. */
export const SNAPSHOT_SCHEMA_VERSION = "0.1";

/** An immutable scan snapshot. */
export interface Snapshot {
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  /** Unique per scan, e.g. a UTC timestamp slug. */
  readonly runId: string;
  /** ISO-8601 snapshot creation time. */
  readonly createdAt: string;
  /** One result per connector attempted, successes and recorded failures. */
  readonly connectors: readonly ConnectorResult[];
  /** Deduplicated normalized documents. */
  readonly documents: readonly SourceDocument[];
}

function isConnectorResult(value: unknown): value is ConnectorResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.connectorId === "string" &&
    r.connectorId.length > 0 &&
    typeof r.kind === "string" &&
    typeof r.ok === "boolean" &&
    typeof r.capturedAt === "string"
  );
}

function isSourceDocument(value: unknown): value is SourceDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const d = value as Record<string, unknown>;
  return (
    typeof d.docId === "string" &&
    /^[0-9a-f]{12}$/.test(d.docId) &&
    typeof d.contentHash === "string" &&
    /^[0-9a-f]{64}$/.test(d.contentHash) &&
    d.docId === d.contentHash.slice(0, 12) &&
    typeof d.sourceId === "string" &&
    typeof d.kind === "string" &&
    (DOCUMENT_KINDS as readonly string[]).includes(d.kind) &&
    typeof d.title === "string" &&
    typeof d.text === "string" &&
    typeof d.url === "string" &&
    typeof d.capturedAt === "string"
  );
}

/** Narrow an unknown parsed value to {@link Snapshot} per the locked schema. */
export function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const s = value as Record<string, unknown>;
  return (
    s.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    typeof s.runId === "string" &&
    s.runId.length > 0 &&
    typeof s.createdAt === "string" &&
    Array.isArray(s.connectors) &&
    s.connectors.every(isConnectorResult) &&
    Array.isArray(s.documents) &&
    s.documents.every(isSourceDocument)
  );
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Locked evidence reference format: a docId in square brackets. */
export function formatEvidenceRef(docId: string): string {
  return `[${docId}]`;
}

/** Matches a locked-format evidence reference. */
export const EVIDENCE_REF_PATTERN = /\[[0-9a-f]{12}\]/g;

/** A bounded evidence bundle: one topic with its traceable documents. */
export interface EvidenceBundle {
  readonly topicId: string;
  readonly title: string;
  readonly documents: readonly SourceDocument[];
  /** Document counts per sourceId, for breadth checks. */
  readonly sourceCounts: Readonly<Record<string, number>>;
}

/** Count documents per sourceId for an evidence bundle. */
export function sourceCountsOf(docs: readonly SourceDocument[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const doc of docs) {
    counts[doc.sourceId] = (counts[doc.sourceId] ?? 0) + 1;
  }
  return counts;
}

export * from "./captures.js";
export * from "./clustering.js";
export * from "./connectors.js";
export * from "./research-connectors.js";
export * from "./snapshot-store.js";
