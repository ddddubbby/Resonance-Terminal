/**
 * Corpus clustering: stage three of the scan lifecycle.
 *
 * Groups the textual documents of a scan into preliminary event clusters so
 * stage four can measure cross-source convergence. The pipeline is
 * tokenize -> TF-IDF -> greedy centroid clustering -> size-sorted clusters.
 *
 * Corrects four measured defects of the spike prototype
 * (`spike/scripts/cluster.mjs`, run 2026-08-23T16-24-41):
 *
 * 1. The spike's centroid update only visited the incoming document's terms,
 *    so absent terms never shrank and centroid norms inflated beyond 1.0
 *    (measured max 1.248), biasing membership toward large clusters. Here
 *    clusters store raw term sums; similarity divides by the sum norm at
 *    compare time, which is exact cosine against the true mean direction.
 * 2. Structured numeric rows (movers, TVL rows, positioning rows, ...) carry
 *    no text semantics. Only `news` and `release` documents are clustered;
 *    the structured kinds feed stage-four metrics directly.
 * 3. Pure-digit tokens have near-zero document frequency and therefore
 *    extreme IDF; they dominated large clusters' top terms (27.3% began with
 *    a digit). Pure-digit tokens now bucket to `number`, matching the
 *    existing `0x`-address bucketing.
 * 4. The threshold is calibrated against the corrected metric and corpus,
 *    not carried forward from the broken one.
 *
 * Determinism and stability are separate properties here. Same input with
 * the same config yields the same output (traceable); but greedy clustering
 * is order-sensitive, so different document orders yield different clusters.
 * Clusters are therefore RUN-LOCAL: `c000` in one run is unrelated to `c000`
 * in another, and narrative identity across runs belongs to stage four
 * (recorded in DESIGN.md).
 *
 * Clustering output is a derived view, not part of the locked snapshot: the
 * artifact persists next to the snapshot with its versioned configuration
 * embedded, so a config fix re-derives history without re-fetching.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentKind, SourceDocument } from "./index.js";
import { canonicalJsonString } from "./snapshot-store.js";

// ---------------------------------------------------------------------------
// Versioned configuration
// ---------------------------------------------------------------------------

/**
 * Stopword list, configuration version 1. Includes generic English glue plus
 * domain terms that appear in nearly every crypto document and therefore
 * carry no grouping signal.
 */
const STOPWORDS_V1 = (
  "a an and are as at be but by for from has have how in into is it its may more new of on or " +
  "our over said says than that the their there these they this to was were what when where " +
  "which who will with you your we us not no can could would should after before between during " +
  "up down out about against because under again further then once here all any both each few " +
  "other some such only own same so too very s t just don now also via using use used per " +
  "percent billion million usd usdt crypto news price data"
).split(" ");

/**
 * Clustering configuration. Effectively scoring configuration: changing any
 * field rewrites all derived cluster output, so the full configuration is
 * embedded in every persisted artifact and carries a version of its own.
 */
export interface ClusteringConfig {
  /** Version of this configuration; bump when stopwords change. */
  readonly configVersion: "1";
  /** Terms removed before vectorization. */
  readonly stopwords: readonly string[];
  /** Minimum cosine against a cluster's mean direction for membership. */
  readonly threshold: number;
  /** Document kinds with text semantics; all other kinds are excluded. */
  readonly kinds: readonly DocumentKind[];
}

/**
 * The calibrated default configuration. Threshold 0.16 was calibrated on
 * the spike corpus (240 textual documents of run 2026-08-23T16-24-41): the
 * lowest threshold whose largest clusters stay single coherent events
 * (at 0.10 the top cluster mixes rally, XRP, and Treasury-buyback stories).
 * Measured at 0.16: 37 multi-doc clusters, 28 cross-source — 75.7% of
 * multi-doc and 16.8% of all clusters, versus the spike baseline of 41.7%
 * and 11.9% under the defective metric.
 */
export const DEFAULT_CLUSTERING_CONFIG: ClusteringConfig = {
  configVersion: "1",
  stopwords: STOPWORDS_V1,
  threshold: 0.16,
  kinds: ["news", "release"],
};

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/** Bucket token for any `0x`-prefixed hex address. */
const ADDRESS_BUCKET = "address";

/** Bucket token for pure-digit tokens (see module docs, defect 3). */
const NUMBER_BUCKET = "number";

const TOKEN_PATTERN = /[a-z0-9]+/g;
const PURE_DIGITS = /^[0-9]+$/;
const HEX_ADDRESS = /^0x[0-9a-f]+$/;

/** Lowercase, split, drop glue words, bucket non-semantic tokens. */
export function tokenize(text: string, stopwords: ReadonlySet<string>): string[] {
  return (text.toLowerCase().match(TOKEN_PATTERN) ?? [])
    .filter((token) => token.length > 2 && !stopwords.has(token))
    .map((token) => {
      if (HEX_ADDRESS.test(token)) {
        return ADDRESS_BUCKET;
      }
      if (PURE_DIGITS.test(token)) {
        return NUMBER_BUCKET;
      }
      return token;
    });
}

/** A member document as recorded in a cluster. */
export interface ClusterMember {
  readonly docId: string;
  readonly sourceId: string;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly url: string;
  readonly publishedAt?: string;
}

/** One preliminary event cluster, run-local identity. */
export interface Cluster {
  /** Run-local index, assigned after sorting by size (`c000`, `c001`, ...). */
  readonly clusterId: string;
  readonly size: number;
  /** Up to twelve terms characterizing the cluster's mean direction. */
  readonly topTerms: readonly string[];
  readonly docs: readonly ClusterMember[];
}

type TermVector = Map<string, number>;

function vectorize(tokens: string[], idf: (term: string) => number): TermVector {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  const vector: TermVector = new Map();
  let norm = 0;
  for (const [term, count] of tf) {
    const weight = (1 + Math.log(count)) * idf(term);
    vector.set(term, weight);
    norm += weight * weight;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [term, weight] of vector) {
    vector.set(term, weight / norm);
  }
  return vector;
}

/** Cosine of a unit-norm vector against a cluster's raw term sums. */
function cosineAgainstSums(unit: TermVector, sums: TermVector): number {
  let dot = 0;
  let sumNorm = 0;
  const [small, big] = unit.size < sums.size ? [unit, sums] : [sums, unit];
  for (const [term, weight] of small) {
    const other = big.get(term);
    if (other !== undefined) {
      dot += weight * other;
    }
  }
  for (const weight of sums.values()) {
    sumNorm += weight * weight;
  }
  sumNorm = Math.sqrt(sumNorm);
  return sumNorm === 0 ? 0 : dot / sumNorm;
}

/**
 * Cluster the textual documents of a corpus. Only documents whose kind is in
 * `config.kinds` participate; the rest feed stage-four metrics instead.
 * Deterministic for a fixed input order and configuration, but order-
 * sensitive (see module docs).
 */
export function clusterDocuments(
  docs: readonly SourceDocument[],
  config: ClusteringConfig = DEFAULT_CLUSTERING_CONFIG,
): Cluster[] {
  const stopwords = new Set(config.stopwords);
  const clustered = docs.filter((doc) => config.kinds.includes(doc.kind));

  const tokenLists = clustered.map((doc) => tokenize(`${doc.title} ${doc.text}`, stopwords));
  const df = new Map<string, number>();
  for (const tokens of tokenLists) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const n = clustered.length;
  const idf = (term: string): number => Math.log(1 + n / (1 + (df.get(term) ?? 0)));
  const vectors = tokenLists.map((tokens) => vectorize(tokens, idf));

  // Greedy: join the best cluster whose mean-direction cosine clears the
  // threshold, otherwise seed a new cluster. Sums (not means) are stored so
  // membership compares exact cosine; see module docs, defect 1.
  const groups: { docIdx: number[]; sums: TermVector }[] = [];
  for (let i = 0; i < vectors.length; i++) {
    const vector = vectors[i];
    if (vector === undefined) {
      continue;
    }
    let best: { docIdx: number[]; sums: TermVector } | undefined;
    let bestSim = 0;
    for (const group of groups) {
      const sim = cosineAgainstSums(vector, group.sums);
      if (sim > bestSim) {
        bestSim = sim;
        best = group;
      }
    }
    if (best !== undefined && bestSim >= config.threshold) {
      best.docIdx.push(i);
      for (const [term, weight] of vector) {
        best.sums.set(term, (best.sums.get(term) ?? 0) + weight);
      }
    } else {
      groups.push({ docIdx: [i], sums: new Map(vector) });
    }
  }

  const emit = (group: { docIdx: number[]; sums: TermVector }, clusterId: string): Cluster => {
    const topTerms = [...group.sums.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([term]) => term);
    const members: ClusterMember[] = [];
    for (const i of group.docIdx) {
      const doc = clustered[i];
      if (doc === undefined) {
        continue;
      }
      members.push({
        docId: doc.docId,
        sourceId: doc.sourceId,
        kind: doc.kind,
        title: doc.title,
        url: doc.url,
        ...(doc.publishedAt !== undefined ? { publishedAt: doc.publishedAt } : {}),
      });
    }
    return {
      clusterId,
      size: group.docIdx.length,
      topTerms,
      docs: members,
    };
  };

  const sorted = [...groups].sort((a, b) => b.docIdx.length - a.docIdx.length);
  return sorted.map((group, idx) => emit(group, `c${String(idx).padStart(3, "0")}`));
}

// ---------------------------------------------------------------------------
// Cross-source quality metric
// ---------------------------------------------------------------------------

/** Cross-source convergence report over a set of clusters. */
export interface CrossSourceReport {
  readonly clusters: number;
  readonly multiDoc: number;
  /** Multi-doc clusters drawing from at least two distinct sources. */
  readonly crossSource: number;
  /** `crossSource / multiDoc`, or 0 when there are no multi-doc clusters. */
  readonly shareOfMulti: number;
  /** `crossSource / clusters`, or 0 for an empty cluster set. */
  readonly shareOfAll: number;
}

/**
 * Measure cross-source convergence: the share of clusters where independent
 * sources report the same event. This is the resonance signal the terminal
 * exists to surface; stage four reuses this metric.
 */
export function crossSourceShare(clusters: readonly Cluster[]): CrossSourceReport {
  const multiDoc = clusters.filter((c) => c.size > 1);
  const isCross = (c: Cluster): boolean => new Set(c.docs.map((d) => d.sourceId)).size > 1;
  const crossSource = multiDoc.filter(isCross).length;
  return {
    clusters: clusters.length,
    multiDoc: multiDoc.length,
    crossSource,
    shareOfMulti: multiDoc.length === 0 ? 0 : crossSource / multiDoc.length,
    shareOfAll: clusters.length === 0 ? 0 : crossSource / clusters.length,
  };
}

// ---------------------------------------------------------------------------
// Artifact persistence
// ---------------------------------------------------------------------------

/** Cluster artifact schema version, independent of the snapshot schema. */
export const CLUSTERING_ARTIFACT_VERSION = "0.1";

/**
 * The persisted clustering output of one run: a derived view of the snapshot
 * documents under a specific versioned configuration.
 */
export interface ClusterArtifact {
  readonly schemaVersion: typeof CLUSTERING_ARTIFACT_VERSION;
  readonly runId: string;
  /** ISO-8601 time the clustering ran. */
  readonly createdAt: string;
  /** Full configuration used, so history is re-derivable without guessing. */
  readonly config: ClusteringConfig;
  readonly clusters: readonly Cluster[];
}

/** Failure codes for cluster artifact persistence. */
export type ClusterStoreErrorCode = "clusters-exist";

/** Error thrown by cluster artifact persistence, with a stable `code`. */
export class ClusterStoreError extends Error {
  readonly code: ClusterStoreErrorCode;

  constructor(code: ClusterStoreErrorCode, message: string) {
    super(message);
    this.name = "ClusterStoreError";
    this.code = code;
  }
}

/** File name of the cluster artifact inside a run directory. */
export const CLUSTERS_FILE = "clusters.json";

/** Path of the cluster artifact inside a run directory. */
export function clustersPath(runDir: string): string {
  return join(runDir, CLUSTERS_FILE);
}

/**
 * Persist the cluster artifact of a run next to its snapshot. Immutable:
 * rewrites are refused. Serialized deterministically for minimal git diffs.
 */
export function writeClusters(runDir: string, artifact: ClusterArtifact): string {
  const path = clustersPath(runDir);
  if (existsSync(path)) {
    throw new ClusterStoreError(
      "clusters-exist",
      `clusters already exist in ${runDir} and are immutable`,
    );
  }
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path, canonicalJsonString(artifact), "utf8");
  return path;
}

/** Read a persisted cluster artifact back; `null` when absent. */
export function readClusters(runDir: string): ClusterArtifact | null {
  const path = clustersPath(runDir);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as ClusterArtifact;
}
