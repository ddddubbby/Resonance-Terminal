/**
 * Event grouping: the agent-side grouping step of the narrative-granularity
 * direction (DESIGN.md).
 *
 * Lexical clustering was demoted to deduplication and context reduction: it
 * produces pre-grouping hints, never narrative decisions. Event grouping
 * itself happens agent-side in v1 — the grouping step reads the textual
 * corpus with the lexical hints, and produces groups with written
 * rationale, stamped with model and rules version. Interpretation is
 * recorded as interpretation.
 *
 * This module owns the record shapes, their validation and persistence
 * (`<runDir>/grouping.json`, a run-local derived view like clusters), and
 * the lexical hint generator built on the merged clustering module.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ClusteringConfig, clusterDocuments } from "./clustering.js";
import type { SourceDocument } from "./index.js";
import { canonicalJsonString } from "./snapshot-store.js";

/** Grouping rules version, stamped into every record. */
export const GROUPING_RULES_VERSION = "1";

/** Grouping record schema version. */
export const GROUPING_SCHEMA_VERSION = "0.1";

/**
 * One event group of a scan, produced by the agent-side grouping step.
 * `narrativeId` is present when the group extends an existing narrative;
 * absent when it establishes a new one (identity allocated by
 * {@link applyGrouping}).
 */
export interface EventGroup {
  /** Run-local id, `g000`, `g001`, … */
  readonly groupId: string;
  readonly title: string;
  /** Theme-level label; defaults to the title for new narratives. */
  readonly theme?: string;
  /** Written rationale for the grouping decision. */
  readonly rationale: string;
  readonly docIds: readonly string[];
  readonly narrativeId?: string;
}

/** The complete grouping output of one scan. */
export interface GroupingRecord {
  readonly schemaVersion: typeof GROUPING_SCHEMA_VERSION;
  readonly runId: string;
  /** ISO-8601 time the grouping was produced. */
  readonly groupedAt: string;
  /** Model stamp of the agent that grouped. */
  readonly model: string;
  readonly rulesVersion: typeof GROUPING_RULES_VERSION;
  readonly groups: readonly EventGroup[];
}

/** Failure codes for grouping operations. */
export type GroupingErrorCode =
  | "grouping-exists"
  | "invalid-group-id"
  | "duplicate-group-id"
  | "empty-group"
  | "empty-rationale"
  | "duplicate-document"
  | "invalid-doc-id"
  | "invalid-narrative-id";

/** Error thrown by grouping operations, with a stable `code`. */
export class GroupingError extends Error {
  readonly code: GroupingErrorCode;

  constructor(code: GroupingErrorCode, message: string) {
    super(message);
    this.name = "GroupingError";
    this.code = code;
  }
}

const GROUP_ID_PATTERN = /^g[0-9]{3,}$/;
const DOC_ID_PATTERN = /^[0-9a-f]{12}$/;
const NARRATIVE_ID_PATTERN = /^n[0-9]{4,}$/;

/** File name of the grouping record inside a run directory. */
export const GROUPING_FILE = "grouping.json";

/** Path of the grouping record inside a run directory. */
export function groupingPath(runDir: string): string {
  return join(runDir, GROUPING_FILE);
}

/** Read the grouping record of a run; `null` when the run has none yet. */
export function readGrouping(runDir: string): GroupingRecord | null {
  const path = groupingPath(runDir);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as GroupingRecord;
}

/**
 * Validate a grouping record. Enforces well-formed ids, non-empty
 * rationale, and one-event membership per document: a document may only
 * describe one event of the scan.
 */
export function validateGrouping(record: GroupingRecord): void {
  const seenGroups = new Set<string>();
  const seenDocs = new Set<string>();
  for (const group of record.groups) {
    if (!GROUP_ID_PATTERN.test(group.groupId)) {
      throw new GroupingError(
        "invalid-group-id",
        `groupId must match ${GROUP_ID_PATTERN} (got "${group.groupId}")`,
      );
    }
    if (seenGroups.has(group.groupId)) {
      throw new GroupingError("duplicate-group-id", `groupId ${group.groupId} appears twice`);
    }
    seenGroups.add(group.groupId);
    if (group.rationale.trim() === "") {
      throw new GroupingError("empty-rationale", `group ${group.groupId} has no rationale`);
    }
    if (group.docIds.length === 0) {
      throw new GroupingError("empty-group", `group ${group.groupId} has no documents`);
    }
    for (const docId of group.docIds) {
      if (!DOC_ID_PATTERN.test(docId)) {
        throw new GroupingError(
          "invalid-doc-id",
          `docId must be 12 hex chars (got "${docId}" in ${group.groupId})`,
        );
      }
      if (seenDocs.has(docId)) {
        throw new GroupingError(
          "duplicate-document",
          `document ${docId} is assigned to more than one group`,
        );
      }
      seenDocs.add(docId);
    }
    if (group.narrativeId !== undefined && !NARRATIVE_ID_PATTERN.test(group.narrativeId)) {
      throw new GroupingError(
        "invalid-narrative-id",
        `narrativeId must match ${NARRATIVE_ID_PATTERN} (got "${group.narrativeId}")`,
      );
    }
  }
}

/**
 * Persist the grouping record of a run. Run-local, immutable, serialized
 * deterministically for minimal git diffs.
 */
export function writeGrouping(runDir: string, record: GroupingRecord): string {
  const path = groupingPath(runDir);
  if (existsSync(path)) {
    throw new GroupingError("grouping-exists", `grouping already recorded for ${runDir}`);
  }
  validateGrouping(record);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path, canonicalJsonString(record), "utf8");
  return path;
}

// ---------------------------------------------------------------------------
// Lexical pre-grouping hints (context reduction)
// ---------------------------------------------------------------------------

/** One lexical hint: candidate same-event documents found by similarity. */
export interface PreGroupHint {
  readonly docIds: readonly string[];
  readonly titles: readonly string[];
  readonly topTerms: readonly string[];
}

/**
 * Generate lexical pre-grouping hints with the merged clustering module.
 * High precision, low recall by measurement — hints, not decisions: they
 * surface proper-noun-driven same-event candidates so the grouping step
 * reads less redundant context, while paraphrased same-event coverage is
 * found by the agent.
 */
export function preGroupHints(
  documents: readonly SourceDocument[],
  config?: ClusteringConfig,
): PreGroupHint[] {
  const clusters = clusterDocuments(documents, config);
  return clusters
    .filter((cluster) => cluster.size >= 2)
    .map((cluster) => ({
      docIds: cluster.docs.map((member) => member.docId),
      titles: cluster.docs.map((member) => member.title),
      topTerms: cluster.topTerms,
    }));
}
