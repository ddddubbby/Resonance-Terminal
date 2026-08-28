/**
 * Partial scoring under the approved scoring direction (DESIGN.md) and the
 * approved narrative-granularity revision: components attach to narratives,
 * not scans. Scan-level scoring never shipped; this is the scored unit from
 * the start.
 *
 * Six weighted components, one time-series observation per manual scan per
 * narrative, a cold-start gate for attention-derived components, and partial
 * scores with explicit coverage until every component is available.
 *
 * Component availability is honest by construction: a component without its
 * required inputs is recorded as unavailable, never scored as zero. The
 * partial score reweights the available components and reports coverage; a
 * full score requires every component.
 *
 * Component split:
 *
 * - Attention-derived (gated): momentum, novelty, breadth, unsaturation.
 *   They measure how a narrative's cross-source attention changes across
 *   scans, which is meaningless before the gate is passed for that
 *   narrative.
 * - Single-scan (ungated): marketConfirmation and investability. Both are
 *   measurable from one scan's documents and market data.
 *
 * Observations persist as an append-only ledger next to the snapshots
 * (`<storeDir>/observations.json`); scoring state is a derived artifact,
 * not part of the locked snapshot schema.
 *
 * Mention resolution lives in `assets.ts`: connectors stay source-neutral and
 * do not fill `asset` for textual kinds, so the scan stage resolves mentions
 * against a snapshot-derived asset index. Every component here compares
 * canonical uppercase tickers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAssetIndex, resolveMentions, TEXTUAL_KINDS } from "./assets.js";
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

/** Minimum observations of a narrative before its attention components
 * become available. */
export const COLD_START_SCANS = 3;

/** Minimum calendar days spanned by those observations. */
export const COLD_START_DAYS = 7;

/** One time-series observation of one narrative, recorded per manual scan. */
export interface NarrativeObservation {
  /** Links the observation to its snapshot. */
  readonly runId: string;
  /** ISO-8601 scan time. */
  readonly scannedAt: string;
  /** The narrative this observation belongs to. */
  readonly narrativeId: string;
  /** Documents the grouping assigned to the narrative this scan. */
  readonly documents: number;
  /** Distinct sources covering the narrative this scan. */
  readonly sources: number;
  /** Distinct assets mentioned by the narrative's documents. */
  readonly assetsMentioned: readonly string[];
  /** Distinct base assets of the scan's exchange market documents. */
  readonly marketAssets: readonly string[];
  /** Off-radar movers of the scan, supplied by the scan pipeline. */
  readonly movers: readonly AssetMove[];
  /** Textual documents of the whole scan; the unsaturation denominator. */
  readonly corpusDocuments: number;
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
export function coldStartSatisfied(
  observations: readonly {
    scannedAt: string;
  }[],
): boolean {
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
// Mention resolution
// ---------------------------------------------------------------------------

/**
 * Mention resolution moved to `assets.ts`, where the vocabulary is derived
 * from the snapshot instead of declared as a literal. `MENTION_RULES_VERSION`,
 * `resolveMention`, and `resolveMentions` are re-exported by the package
 * index from there; this module consumes them.
 */

// ---------------------------------------------------------------------------
// Observation builder
// ---------------------------------------------------------------------------

/** Inputs for {@link buildNarrativeObservation}. */
export interface NarrativeObservationInput {
  readonly runId: string;
  readonly scannedAt: string;
  readonly narrativeId: string;
  /** Documents the grouping assigned to the narrative this scan. */
  readonly narrativeDocuments: readonly SourceDocument[];
  /** Every document of the scan; market assets and corpus size derive here. */
  readonly corpus: readonly SourceDocument[];
  readonly movers?: readonly AssetMove[];
}

/**
 * Derive one narrative's observation of one scan from locked-contract
 * inputs. Everything derivable from the contracts is derived here; only the
 * movers (which live in raw captures) are supplied by the caller.
 */
export function buildNarrativeObservation(input: NarrativeObservationInput): NarrativeObservation {
  // The vocabulary comes from the whole scan, never from the narrative's own
  // documents: a narrative holds only textual kinds, so an index built from
  // them would have an empty tradeable universe and resolve nothing.
  const index = buildAssetIndex(input.corpus);
  const narrativeDocs = resolveMentions(input.narrativeDocuments, index);
  const corpus = resolveMentions(input.corpus, index);
  const assetsMentioned = [
    ...new Set(narrativeDocs.map((d) => d.asset).filter((a) => a !== undefined)),
  ].sort();
  const marketAssets = [
    ...new Set(
      corpus
        .filter((d) => d.kind === "market")
        .map((d) => d.asset)
        .filter((a) => a !== undefined),
    ),
  ].sort();
  return {
    runId: input.runId,
    scannedAt: input.scannedAt,
    narrativeId: input.narrativeId,
    documents: narrativeDocs.length,
    sources: new Set(narrativeDocs.map((d) => d.sourceId)).size,
    assetsMentioned,
    marketAssets,
    movers: [...(input.movers ?? [])],
    corpusDocuments: corpus.filter((d) => TEXTUAL_KINDS.has(d.kind)).length,
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

/** A partial (or full) score of one narrative, with explicit coverage. */
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

function sortByTime(series: readonly NarrativeObservation[]): NarrativeObservation[] {
  return [...series].sort(
    (a, b) => new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime(),
  );
}

/**
 * Momentum: relative growth of the narrative's document volume between the
 * first and the latest gated observation. Flat is 0.5, tripling saturates
 * at 1.0, halving-or-worse saturates at 0.
 */
function momentumScore(series: readonly NarrativeObservation[]): ComponentResult {
  const first = series[0];
  const last = series[series.length - 1];
  if (first === undefined || last === undefined || series.length < 2) {
    return unavailable("momentum", "insufficient-history");
  }
  const base = Math.max(first.documents, 1);
  const growth = (last.documents - first.documents) / base;
  return available("momentum", clamp01(0.5 + growth / 2));
}

/**
 * Novelty: the share of the narrative's latest mentioned assets never seen
 * in its earlier gated observations. All new is 1, all repeat is 0.
 */
function noveltyScore(series: readonly NarrativeObservation[]): ComponentResult {
  const latest = series[series.length - 1];
  if (latest === undefined || series.length < 2) {
    return unavailable("novelty", "insufficient-history");
  }
  if (latest.assetsMentioned.length === 0) {
    return unavailable("novelty", "missing-input");
  }
  const seen = new Set(series.slice(0, -1).flatMap((o) => o.assetsMentioned));
  const fresh = latest.assetsMentioned.filter((a) => !seen.has(a)).length;
  return available("novelty", fresh / latest.assetsMentioned.length);
}

/**
 * Breadth: how many independent sources converge on the narrative. A single
 * source scores 0; four or more saturate at 1.
 */
function breadthScore(latest: NarrativeObservation): ComponentResult {
  if (latest.documents === 0) {
    return unavailable("breadth", "missing-input");
  }
  return available("breadth", clamp01((latest.sources - 1) / 3));
}

/**
 * Unsaturation: how much of the scan's attention the narrative does not yet
 * own. A narrative holding the whole corpus is saturated (0); one holding a
 * sliver has room to grow (~1).
 */
function unsaturationScore(latest: NarrativeObservation): ComponentResult {
  if (latest.corpusDocuments === 0) {
    return unavailable("unsaturation", "missing-input");
  }
  const saturation = latest.documents / latest.corpusDocuments;
  return available("unsaturation", clamp01(1 - saturation));
}

/**
 * Market confirmation: movers whose asset the narrative also talks about.
 * Three or more confirming movers saturate at 1.
 */
function marketConfirmationScore(latest: NarrativeObservation): ComponentResult {
  if (latest.movers.length === 0 || latest.assetsMentioned.length === 0) {
    return unavailable("marketConfirmation", "missing-input");
  }
  // Both sides are canonical uppercase tickers since mention rules 2; the
  // normalization here keeps the comparison correct for observations written
  // by earlier rules rather than silently scoring them zero.
  const mentioned = new Set(latest.assetsMentioned.map((a) => a.toUpperCase()));
  const confirming = latest.movers.filter((m) => mentioned.has(m.asset.toUpperCase())).length;
  return available("marketConfirmation", clamp01(confirming / 3));
}

/** Investability: the share of the narrative's assets listed on tracked
 * exchanges. */
function investabilityScore(latest: NarrativeObservation): ComponentResult {
  if (latest.assetsMentioned.length === 0) {
    return unavailable("investability", "missing-input");
  }
  const listed = new Set(latest.marketAssets.map((a) => a.toUpperCase()));
  const investable = latest.assetsMentioned.filter((a) => listed.has(a.toUpperCase())).length;
  return available("investability", investable / latest.assetsMentioned.length);
}

function available(component: ScoreComponent, score: number): ComponentResult {
  return { component, weight: COMPONENT_WEIGHTS[component], available: true, score };
}

function unavailable(component: ScoreComponent, reason: UnavailabilityReason): ComponentResult {
  return { component, weight: COMPONENT_WEIGHTS[component], available: false, reason };
}

/**
 * Score one narrative under the approved rules. Attention components wait
 * for the cold-start gate on the narrative's own series; available
 * components reweight into the partial score with explicit coverage; a full
 * score needs all six.
 */
export function narrativeScore(observations: readonly NarrativeObservation[]): PartialScore {
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

/** Score every narrative of an observation ledger, keyed by narrativeId. */
export function scoreAll(
  observations: readonly NarrativeObservation[],
): ReadonlyMap<string, PartialScore> {
  const byNarrative = new Map<string, NarrativeObservation[]>();
  for (const observation of observations) {
    const bucket = byNarrative.get(observation.narrativeId) ?? [];
    bucket.push(observation);
    byNarrative.set(observation.narrativeId, bucket);
  }
  const scores = new Map<string, PartialScore>();
  for (const [narrativeId, series] of byNarrative) {
    scores.set(narrativeId, narrativeScore(series));
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Observation ledger persistence
// ---------------------------------------------------------------------------

/** Observation ledger schema version. */
export const OBSERVATIONS_SCHEMA_VERSION = "0.1";

/** The persisted observation ledger of a store. */
export interface ObservationLedger {
  readonly schemaVersion: typeof OBSERVATIONS_SCHEMA_VERSION;
  readonly observations: readonly NarrativeObservation[];
}

/** Failure codes for observation ledger operations. */
export type ObservationStoreErrorCode = "invalid-run-id" | "duplicate-observation";

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
export function readObservations(storeDir: string): NarrativeObservation[] {
  const path = observationsPath(storeDir);
  if (!existsSync(path)) {
    return [];
  }
  const ledger = JSON.parse(readFileSync(path, "utf8")) as ObservationLedger;
  return [...ledger.observations];
}

/**
 * Append one observation to the ledger. Refuses a second observation of the
 * same narrative in the same run, and traversal-unsafe run ids; serialized
 * deterministically for minimal git diffs.
 */
export function addObservation(storeDir: string, observation: NarrativeObservation): string {
  if (!RUN_ID_PATTERN.test(observation.runId)) {
    throw new ObservationStoreError(
      "invalid-run-id",
      `runId must match ${RUN_ID_PATTERN} (got "${observation.runId}")`,
    );
  }
  const observations = readObservations(storeDir);
  if (
    observations.some(
      (o) => o.runId === observation.runId && o.narrativeId === observation.narrativeId,
    )
  ) {
    throw new ObservationStoreError(
      "duplicate-observation",
      `observation for narrative ${observation.narrativeId} of run ${observation.runId} already exists`,
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
