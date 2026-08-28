/**
 * Promotion ledger: which narratives the operator has promoted to the
 * private alpha shortlist. Append-only, one promotion per narrative.
 *
 * Promotion is an operator decision, not a score threshold: the scores
 * inform it, the ledger records it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readNarratives } from "./narratives.js";
import { canonicalJsonString } from "./snapshot-store.js";

/** Promotion ledger schema version. */
export const PROMOTIONS_SCHEMA_VERSION = "0.1";

/** One promotion decision. */
export interface Promotion {
  readonly narrativeId: string;
  /** ISO-8601 promotion time. */
  readonly promotedAt: string;
  /** Run the promotion was made against, when known. */
  readonly runId?: string;
  /** Free operator note (why this narrative). */
  readonly note?: string;
}

/** The persisted promotion ledger of a store. */
export interface PromotionLedger {
  readonly schemaVersion: typeof PROMOTIONS_SCHEMA_VERSION;
  readonly promotions: readonly Promotion[];
}

/** Errors raised by the promotion ledger. */
export class PromotionError extends Error {
  constructor(
    readonly code: "unknown-narrative" | "duplicate-promotion" | "invalid-narrative-id",
    message: string,
  ) {
    super(message);
    this.name = "PromotionError";
  }
}

/** File name of the promotion ledger inside a store directory. */
export const PROMOTIONS_FILE = "promotions.json";

/** Read the ledger; an empty list when the store has none yet. */
export function readPromotions(storeDir: string): Promotion[] {
  const path = join(storeDir, PROMOTIONS_FILE);
  if (!existsSync(path)) {
    return [];
  }
  const ledger = JSON.parse(readFileSync(path, "utf8")) as PromotionLedger;
  return [...ledger.promotions];
}

/** Input for {@link promoteNarrative}. */
export interface PromotionInput {
  readonly narrativeId: string;
  /** ISO-8601 promotion time; defaults to now. */
  readonly promotedAt?: string;
  readonly runId?: string;
  readonly note?: string;
}

/**
 * Append one promotion to the ledger. The narrative must exist; each
 * narrative is promoted at most once. Serialized deterministically for
 * minimal git diffs.
 */
export function promoteNarrative(storeDir: string, input: PromotionInput): Promotion {
  if (!/^n[0-9]{4,}$/.test(input.narrativeId)) {
    throw new PromotionError(
      "invalid-narrative-id",
      `narrativeId must match n0001… (got "${input.narrativeId}")`,
    );
  }
  const narratives = readNarratives(storeDir);
  if (!narratives.some((narrative) => narrative.narrativeId === input.narrativeId)) {
    throw new PromotionError(
      "unknown-narrative",
      `narrative ${input.narrativeId} does not exist in this store`,
    );
  }
  const promotions = readPromotions(storeDir);
  if (promotions.some((p) => p.narrativeId === input.narrativeId)) {
    throw new PromotionError(
      "duplicate-promotion",
      `narrative ${input.narrativeId} is already promoted`,
    );
  }
  const promotion: Promotion = {
    narrativeId: input.narrativeId,
    promotedAt: input.promotedAt ?? new Date().toISOString(),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  const ledger: PromotionLedger = {
    schemaVersion: PROMOTIONS_SCHEMA_VERSION,
    promotions: [...promotions, promotion],
  };
  mkdirSync(storeDir, { recursive: true });
  writeFileSync(join(storeDir, PROMOTIONS_FILE), canonicalJsonString(ledger), "utf8");
  return promotion;
}
