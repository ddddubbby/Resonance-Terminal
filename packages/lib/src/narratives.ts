/**
 * Narrative identity: the event-to-theme layer of the narrative-granularity
 * direction (DESIGN.md).
 *
 * Stage three produces events; the product sells themes. This layer owns
 * the bridge: narratives persist across runs in an append-only ledger
 * (`<storeDir>/narratives.json`), so a theme like "stablecoin payments is
 * accelerating" survives the run-local churn of event groups and cluster
 * ids. Supersedes the retired run-local-cluster identity decision.
 *
 * Matching a group to an existing narrative is interpretation and happens
 * agent-side (the grouping record carries the match and its rationale);
 * this module owns identity allocation, ledger integrity, and persistence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GroupingError, type GroupingRecord } from "./grouping.js";
import { canonicalJsonString } from "./snapshot-store.js";

/** Narrative ledger schema version. */
export const NARRATIVES_SCHEMA_VERSION = "0.1";

/** One persistent narrative (theme-level identity). */
export interface Narrative {
  /** Stable id, `n0001`, `n0002`, … allocated in order. */
  readonly narrativeId: string;
  readonly title: string;
  /** Theme-level label; established once, refined only by an approved PR. */
  readonly theme: string;
  /** Run in which the narrative was established. */
  readonly establishedRunId: string;
  /** Latest run whose grouping extended this narrative. */
  readonly lastSeenRunId: string;
}

/** The persisted narrative ledger of a store. */
export interface NarrativeLedger {
  readonly schemaVersion: typeof NARRATIVES_SCHEMA_VERSION;
  readonly narratives: readonly Narrative[];
}

/** Result of applying one grouping record to the ledger. */
export interface GroupingApplication {
  /** Narrative ids allocated for newly established narratives. */
  readonly allocated: readonly string[];
  /** Narrative ids matched by the grouping record. */
  readonly matched: readonly string[];
}

/** File name of the narrative ledger inside a store directory. */
export const NARRATIVES_FILE = "narratives.json";

/** Path of the narrative ledger inside a store directory. */
export function narrativesPath(storeDir: string): string {
  return join(storeDir, NARRATIVES_FILE);
}

/** Read the ledger; an empty list when the store has none yet. */
export function readNarratives(storeDir: string): Narrative[] {
  const path = narrativesPath(storeDir);
  if (!existsSync(path)) {
    return [];
  }
  const ledger = JSON.parse(readFileSync(path, "utf8")) as NarrativeLedger;
  return [...ledger.narratives];
}

function nextNarrativeId(narratives: readonly Narrative[]): string {
  let max = 0;
  for (const narrative of narratives) {
    const n = Number.parseInt(narrative.narrativeId.slice(1), 10);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return `n${String(max + 1).padStart(4, "0")}`;
}

/**
 * Apply one grouping record to the narrative ledger: groups matching an
 * existing narrative refresh it, groups without a match allocate fresh
 * identities (title from the group, theme from the group or its title).
 * Rejects matches against unknown narratives. Serialized deterministically
 * for minimal git diffs.
 */
export function applyGrouping(storeDir: string, record: GroupingRecord): GroupingApplication {
  const narratives = readNarratives(storeDir);
  const known = new Map(narratives.map((narrative) => [narrative.narrativeId, narrative]));
  const allocated: string[] = [];
  const matched: string[] = [];
  const updated = new Map(known);

  for (const group of record.groups) {
    if (group.narrativeId !== undefined) {
      const existing = known.get(group.narrativeId);
      if (existing === undefined) {
        throw new GroupingError(
          "invalid-narrative-id",
          `group ${group.groupId} matches unknown narrative ${group.narrativeId}`,
        );
      }
      updated.set(group.narrativeId, { ...existing, lastSeenRunId: record.runId });
      matched.push(group.narrativeId);
      continue;
    }
    const narrativeId = nextNarrativeId([...updated.values()]);
    updated.set(narrativeId, {
      narrativeId,
      title: group.title,
      theme: group.theme ?? group.title,
      establishedRunId: record.runId,
      lastSeenRunId: record.runId,
    });
    allocated.push(narrativeId);
  }

  if (allocated.length > 0 || matched.length > 0) {
    const ledger: NarrativeLedger = {
      schemaVersion: NARRATIVES_SCHEMA_VERSION,
      narratives: [...updated.values()],
    };
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(narrativesPath(storeDir), canonicalJsonString(ledger), "utf8");
  }
  return { allocated, matched };
}

/**
 * A copy of the grouping record with allocated narrative ids attached to the
 * groups that did not match existing narratives. The allocation order mirrors
 * the order of unmatched groups in the record, exactly as
 * {@link applyGrouping} wrote them into the ledger, so this derivation is
 * deterministic. Use it to feed evidence packs and observations after
 * applying a grouping record.
 */
export function withAllocatedNarrativeIds(
  record: GroupingRecord,
  application: GroupingApplication,
): GroupingRecord {
  const queue = [...application.allocated];
  return {
    ...record,
    groups: record.groups.map((group) => {
      if (group.narrativeId !== undefined) {
        return group;
      }
      const next = queue.shift();
      return next === undefined ? group : { ...group, narrativeId: next };
    }),
  };
}
