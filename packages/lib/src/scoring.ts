/**
 * Partial scoring: stage four of the product, component one of wave 4.
 *
 * Implements the approved scoring direction (DESIGN.md): six weighted
 * components, one time-series observation per manual scan, a cold-start gate
 * for attention-derived components, and partial scores with explicit
 * coverage until every component is available.
 *
 * Component availability is honest by construction: a component without its
 * required inputs is recorded as unavailable, never scored as zero. The
 * partial score reweights the available components and reports coverage; a
 * full score requires every component.
 *
 * Component split:
 *
 * - Attention-derived (gated): momentum, novelty, breadth, unsaturation.
 *   They measure how cross-source attention changes across scans, which is
 *   meaningless before the gate is passed.
 * - Single-scan (ungated): marketConfirmation and investability. Both are
 *   measurable from one scan's documents and market data.
 *
 * Observations persist as an append-only ledger next to the snapshots
 * (`<storeDir>/observations.json`); like clustering, scoring state is a
 * derived artifact, not part of the locked snapshot schema.
 *
 * Mention resolution lives here too: connectors stay source-neutral and do
 * not fill `asset`, so the scan stage resolves mentions with
 * {@link resolveMentions} (rules version {@link MENTION_RULES_VERSION}).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cluster } from "./clustering.js";
import { crossSourceShare } from "./clustering.js";
import type { SourceDocument } from "./index.js";
import { canonicalJsonString } from "./snapshot-store.js";

// ---------------------------------------------------------------------------
// Locked component weights (approved scoring direction, DESIGN.md)
// ---------------------------------------------------------------------------

/** One of the six scored components. */
export type ScoreComponent =
  | "momentum"
  | "novelty"
  | "breadth"
  | "unsaturation"
  | "marketConfirmation"
  | "investability";

/** Locked component weights; they sum to exactly 1. */
export const COMPONENT_WEIGHTS: Readonly<Record<ScoreComponent, number>> = {
  momentum: 0.3,
  novelty: 0.2,
  breadth: 0.15,
  unsaturation: 0.15,
  marketConfirmation: 0.1,
  investability: 0.1,
};

/** Components measuring cross-scan attention change; gated by cold start. */
export const ATTENTION_COMPONENTS: readonly ScoreComponent[] = [
  "momentum",
  "novelty",
  "breadth",
  "unsaturation",
];

// ---------------------------------------------------------------------------
// Cold-start gate
// ---------------------------------------------------------------------------

/** Minimum successful scans before attention components become available. */
export const COLD_START_SCANS = 3;

/** Minimum calendar days spanned by those scans. */
export const COLD_START_DAYS = 7;

/** One time-series observation, recorded by every manual scan. */
export interface ScanObservation {
  /** Links the observation to its snapshot. */
  readonly runId: string;
  /** ISO-8601 scan time. */
  readonly scannedAt: string;
  /** Total preliminary clusters of the run. */
  readonly clusters: number;
  readonly multiDocClusters: number;
  readonly crossSourceClusters: number;
  /** Documents of the clustered (textual) kinds. */
  readonly textualDocuments: number;
  /** Size of the largest cluster; saturation signal. */
  readonly largestClusterSize: number;
  /** Distinct assets mentioned by textual documents. */
  readonly assetsMentioned: readonly string[];
  /** Distinct base assets of exchange market documents. */
  readonly marketAssets: readonly string[];
  /** Off-radar movers with their 24h change, supplied by the scan pipeline. */
  readonly movers: readonly AssetMove[];
}

/** A screened mover: an asset and its 24h percentage change. */
export interface AssetMove {
  readonly asset: string;
  readonly changePercent: number;
}

/**
 * The cold-start gate for attention-derived components: at least
 * {@link COLD_START_SCANS} observations spanning at least
 * {@link COLD_START_DAYS} calendar days.
 */
export function coldStartSatisfied(observations: readonly ScanObservation[]): boolean {
  if (observations.length < COLD_START_SCANS) {
    return false;
  }
  const times = observations
    .map((o) => new Date(o.scannedAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < COLD_START_SCANS) {
    return false;
  }
  const first = times[0];
  const last = times[times.length - 1];
  if (first === undefined || last === undefined) {
    return false;
  }
  return last - first >= COLD_START_DAYS * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Observation builder
// ---------------------------------------------------------------------------

/** Inputs for {@link buildObservation}. Movers come from the raw captures. */
export interface ObservationInput {
  readonly runId: string;
  readonly scannedAt: string;
  readonly documents: readonly SourceDocument[];
  readonly clusters: readonly Cluster[];
  readonly movers?: readonly AssetMove[];
}

// ---------------------------------------------------------------------------
// Mention resolution
// ---------------------------------------------------------------------------

/**
 * Mention resolution rules, versioned. Connectors do not fill `asset` (they
 * stay source-neutral); the scan stage resolves mentions. `resolveMentions`
 * is the canonical implementation, used in production scans and tests alike.
 */
export const MENTION_RULES_VERSION = "1";

const KNOWN_ASSETS_V1: readonly string[] = [
  "bitcoin",
  "btc",
  "ethereum",
  "eth",
  "solana",
  "sol",
  "clarity",
  "genesis",
  "clankster",
];

/**
 * Resolve asset mentions of one textual document against a known-asset
 * vocabulary. Returns the first match or `undefined`. The vocabulary is a
 * seed, not the product's asset universe; extending it is a deliberate,
 * versioned change.
 */
export function resolveMention(
  document: Pick<SourceDocument, "kind" | "title" | "text">,
  assets: readonly string[] = KNOWN_ASSETS_V1,
): string | undefined {
  if (!TEXTUAL_KINDS.has(document.kind)) {
    return undefined;
  }
  const haystack = `${document.title} ${document.text}`.toLowerCase();
  return assets.find((asset) => haystack.includes(asset.toLowerCase()));
}

/**
 * Attach resolved mentions to a document set, keeping originals that already
 * carry an `asset`. Deterministic, source-neutral, side-effect free.
 */
export function resolveMentions(
  documents: readonly SourceDocument[],
  assets: readonly string[] = KNOWN_ASSETS_V1,
): SourceDocument[] {
  return documents.map((document) => {
    if (document.asset !== undefined) {
      return document;
    }
    const asset = resolveMention(document, assets);
    return asset === undefined ? document : { ...document, asset };
  });
}

const TEXTUAL_KINDS = new Set(["news", "release"]);

/**
 * Derive the observation of one scan from its documents and clusters.
 * Everything derivable from the locked contracts is derived here; only the
 * movers (which live in raw captures) are supplied by the caller.
 */
export function buildObservation(input: ObservationInput): ScanObservation {
  const report = crossSourceShare(input.clusters);
  const resolved = resolveMentions(input.documents);
  const textual = resolved.filter((d) => TEXTUAL_KINDS.has(d.kind));
  const assetsMentioned = [
    ...new Set(textual.map((d) => d.asset).filter((a) => a !== undefined)),
  ].sort();
  const marketAssets = [
    ...new Set(
      resolved
        .filter((d) => d.kind === "market")
        .map((d) => d.asset)
        .filter((a) => a !== undefined),
    ),
  ].sort();
  return {
    runId: input.runId,
    scannedAt: input.scannedAt,
    clusters: report.clusters,
    multiDocClusters: report.multiDoc,
    crossSourceClusters: report.crossSource,
    textualDocuments: textual.length,
    largestClusterSize: input.clusters.reduce((max, c) => Math.max(max, c.size), 0),
    assetsMentioned,
    marketAssets,
    movers: [...(input.movers ?? [])],
  };
}

// ---------------------------------------------------------------------------
// Component scores
// ---------------------------------------------------------------------------

/** Why a component is unavailable. */
export type UnavailabilityReason = "cold-start" | "missing-input" | "insufficient-history";

/** One component's result inside a partial score. */
export interface ComponentResult {
  readonly component: ScoreComponent;
  readonly weight: number;
  readonly available: boolean;
  /** Present exactly when `available` is false. */
  readonly reason?: UnavailabilityReason;
  /** Present exactly when `available` is true. */
  readonly score?: number;
}

/** A partial (or full) score with explicit coverage. */
export interface PartialScore {
  /** Reweighted score over available components; `null` when none are. */
  readonly score: number | null;
  /** Sum of the weights of the available components, in [0, 1]. */
  readonly coverage: number;
  /** True exactly when every component is available (coverage 1). */
  readonly full: boolean;
  readonly components: readonly ComponentResult[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function sortByTime(observations: readonly ScanObservation[]): ScanObservation[] {
  return [...observations].sort(
    (a, b) => new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime(),
  );
}

/**
 * Momentum: relative growth of cross-source clusters between the first and
 * the latest gated observation. Flat is 0.5, tripling saturates at 1.0,
 * halving-or-worse saturates at 0.
 */
function momentumScore(window: readonly ScanObservation[]): ComponentResult {
  const first = window[0];
  const last = window[window.length - 1];
  if (first === undefined || last === undefined || window.length < 2) {
    return unavailable("momentum", "insufficient-history");
  }
  const base = Math.max(first.crossSourceClusters, 1);
  const growth = (last.crossSourceClusters - first.crossSourceClusters) / base;
  return available("momentum", clamp01(0.5 + growth / 2));
}

/**
 * Novelty: the share of the latest scan's mentioned assets never seen in the
 * earlier gated observations. All new is 1, all repeat is 0.
 */
function noveltyScore(window: readonly ScanObservation[]): ComponentResult {
  const latest = window[window.length - 1];
  if (latest === undefined || window.length < 2) {
    return unavailable("novelty", "insufficient-history");
  }
  if (latest.assetsMentioned.length === 0) {
    return unavailable("novelty", "missing-input");
  }
  const seen = new Set(window.slice(0, -1).flatMap((o) => o.assetsMentioned));
  const fresh = latest.assetsMentioned.filter((a) => !seen.has(a)).length;
  return available("novelty", fresh / latest.assetsMentioned.length);
}

/** Breadth: the share of convergent events that are cross-source. */
function breadthScore(latest: ScanObservation): ComponentResult {
  if (latest.multiDocClusters === 0) {
    return unavailable("breadth", "missing-input");
  }
  return available("breadth", latest.crossSourceClusters / latest.multiDocClusters);
}

/**
 * Unsaturation: how dispersed attention still is. One cluster owning the
 * whole corpus scores 0; a largest cluster of one document scores ~1.
 */
function unsaturationScore(latest: ScanObservation): ComponentResult {
  if (latest.textualDocuments === 0) {
    return unavailable("unsaturation", "missing-input");
  }
  const saturation = latest.largestClusterSize / latest.textualDocuments;
  return available("unsaturation", clamp01(1 - saturation));
}

/**
 * Market confirmation: movers whose asset the coverage also talks about.
 * Three or more confirming movers saturate at 1.
 */
function marketConfirmationScore(latest: ScanObservation): ComponentResult {
  if (latest.movers.length === 0 || latest.assetsMentioned.length === 0) {
    return unavailable("marketConfirmation", "missing-input");
  }
  const mentioned = new Set(latest.assetsMentioned);
  const confirming = latest.movers.filter((m) => mentioned.has(m.asset)).length;
  return available("marketConfirmation", clamp01(confirming / 3));
}

/** Investability: the share of mentioned assets listed on tracked exchanges. */
function investabilityScore(latest: ScanObservation): ComponentResult {
  if (latest.assetsMentioned.length === 0) {
    return unavailable("investability", "missing-input");
  }
  const listed = new Set(latest.marketAssets);
  const investable = latest.assetsMentioned.filter((a) => listed.has(a)).length;
  return available("investability", investable / latest.assetsMentioned.length);
}

function available(component: ScoreComponent, score: number): ComponentResult {
  return { component, weight: COMPONENT_WEIGHTS[component], available: true, score };
}

function unavailable(component: ScoreComponent, reason: UnavailabilityReason): ComponentResult {
  return { component, weight: COMPONENT_WEIGHTS[component], available: false, reason };
}

/**
 * Score a series of scan observations under the approved rules. Attention
 * components wait for the cold-start gate; available components reweight
 * into the partial score with explicit coverage; a full score needs all six.
 */
export function partialScore(observations: readonly ScanObservation[]): PartialScore {
  const series = sortByTime(observations);
  const latest = series[series.length - 1];
  const gated = coldStartSatisfied(series);

  const components: ComponentResult[] = [];
  if (latest === undefined) {
    for (const component of Object.keys(COMPONENT_WEIGHTS) as ScoreComponent[]) {
      components.push(unavailable(component, "missing-input"));
    }
  } else {
    const attention = gated
      ? [
          momentumScore(series),
          noveltyScore(series),
          breadthScore(latest),
          unsaturationScore(latest),
        ]
      : ATTENTION_COMPONENTS.map((component) => unavailable(component, "cold-start"));
    components.push(...attention, marketConfirmationScore(latest), investabilityScore(latest));
  }

  const usable = components.filter(
    (c): c is ComponentResult & { score: number } => c.available && c.score !== undefined,
  );
  const coverage = usable.reduce((sum, c) => sum + c.weight, 0);
  const score =
    usable.length === 0 ? null : usable.reduce((sum, c) => sum + c.weight * c.score, 0) / coverage;
  return {
    score,
    coverage,
    full: coverage >= 0.999999,
    components,
  };
}

// ---------------------------------------------------------------------------
// Observation ledger persistence
// ---------------------------------------------------------------------------

/** Observation ledger schema version. */
export const OBSERVATIONS_SCHEMA_VERSION = "0.1";

/** The persisted observation ledger of a store. */
export interface ObservationLedger {
  readonly schemaVersion: typeof OBSERVATIONS_SCHEMA_VERSION;
  readonly observations: readonly ScanObservation[];
}

/** Failure codes for observation ledger operations. */
export type ObservationStoreErrorCode = "invalid-run-id" | "duplicate-run-id";

/** Error thrown by observation persistence, with a stable `code`. */
export class ObservationStoreError extends Error {
  readonly code: ObservationStoreErrorCode;

  constructor(code: ObservationStoreErrorCode, message: string) {
    super(message);
    this.name = "ObservationStoreError";
    this.code = code;
  }
}

const RUN_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;

/** File name of the observation ledger inside a store directory. */
export const OBSERVATIONS_FILE = "observations.json";

/** Path of the observation ledger inside a store directory. */
export function observationsPath(storeDir: string): string {
  return join(storeDir, OBSERVATIONS_FILE);
}

/** Read the ledger; an empty list when the store has none yet. */
export function readObservations(storeDir: string): ScanObservation[] {
  const path = observationsPath(storeDir);
  if (!existsSync(path)) {
    return [];
  }
  const ledger = JSON.parse(readFileSync(path, "utf8")) as ObservationLedger;
  return [...ledger.observations];
}

/**
 * Append one observation to the ledger. Refuses runId collisions and
 * traversal-unsafe ids; serialized deterministically for minimal git diffs.
 */
export function addObservation(storeDir: string, observation: ScanObservation): string {
  if (!RUN_ID_PATTERN.test(observation.runId)) {
    throw new ObservationStoreError(
      "invalid-run-id",
      `runId must match ${RUN_ID_PATTERN} (got "${observation.runId}")`,
    );
  }
  const observations = readObservations(storeDir);
  if (observations.some((o) => o.runId === observation.runId)) {
    throw new ObservationStoreError(
      "duplicate-run-id",
      `observation for run ${observation.runId} already exists`,
    );
  }
  const ledger: ObservationLedger = {
    schemaVersion: OBSERVATIONS_SCHEMA_VERSION,
    observations: [...observations, observation],
  };
  mkdirSync(storeDir, { recursive: true });
  const path = observationsPath(storeDir);
  writeFileSync(path, canonicalJsonString(ledger), "utf8");
  return path;
}
