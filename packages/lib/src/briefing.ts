/**
 * The run briefing: what a person should read after a scan.
 *
 * Every artifact before this module is written for the agent or for the
 * record — snapshots, grouping, observations, evidence packs. None of them
 * answers the only question a user actually asks, which is *what changed and
 * what should I look at*. The 2026-08-28 run wrote 16MB and surfaced nothing;
 * this module is what surfaces.
 *
 * Two signals lead, in this order:
 *
 * 1. **Off-radar movers** — assets that moved hard while no narrative in the
 *    corpus mentions them. The scan already screens movers and already
 *    resolves narrative assets; the join between them was never made, so the
 *    highest-signal output of every run was computed and discarded.
 * 2. **Confirmed narratives** — narratives whose assets are among the movers,
 *    ranked by score. News and price agreeing is the thing the score was
 *    designed to find.
 *
 * The briefing is deterministic and derives entirely from what the store
 * already holds. It states its own limits rather than implying completeness:
 * a first run cannot have attention components, and saying so is part of the
 * output.
 */

import type { Narrative } from "./narratives.js";
import type { AssetMove, NarrativeObservation, PartialScore } from "./scoring.js";

/** An asset that moved with no narrative coverage this run. */
export interface UncoveredMover {
  readonly asset: string;
  readonly changePercent: number;
}

/** A narrative whose assets appear among the run's movers. */
export interface ConfirmedNarrative {
  readonly narrativeId: string;
  readonly title: string;
  readonly score: number | null;
  readonly coverage: number;
  readonly assets: readonly string[];
  /** The movers this narrative names, strongest absolute move first. */
  readonly confirming: readonly AssetMove[];
}

/** One run's briefing. */
export interface Briefing {
  readonly runId: string;
  readonly uncovered: readonly UncoveredMover[];
  readonly confirmed: readonly ConfirmedNarrative[];
  /** Narratives that scored but name no mover. */
  readonly quiet: readonly ConfirmedNarrative[];
  /** Narratives with no score at all, and why that is honest. */
  readonly unscored: number;
  /** Plain statements of what this run cannot yet measure. */
  readonly limits: readonly string[];
}

/** Inputs for {@link buildBriefing}; all of it already lives in the store. */
export interface BriefingInput {
  readonly runId: string;
  readonly narratives: readonly Narrative[];
  readonly observations: readonly NarrativeObservation[];
  readonly scores: ReadonlyMap<string, PartialScore>;
  /** How many uncovered movers to report. */
  readonly moverLimit?: number;
}

/** Default number of off-radar movers reported. */
export const DEFAULT_MOVER_LIMIT = 8;

/** Strongest move first, ties broken by asset for determinism. */
function byMagnitude(a: AssetMove, b: AssetMove): number {
  const delta = Math.abs(b.changePercent) - Math.abs(a.changePercent);
  return delta !== 0 ? delta : a.asset.localeCompare(b.asset);
}

/**
 * Build the briefing for one run.
 *
 * Movers are a property of the scan, not of any one narrative: every
 * observation of a run carries the same screened set, so the first
 * observation of the run supplies them.
 */
export function buildBriefing(input: BriefingInput): Briefing {
  const runObservations = input.observations.filter((o) => o.runId === input.runId);
  const movers = runObservations[0]?.movers ?? [];

  const covered = new Set<string>();
  for (const observation of runObservations) {
    for (const asset of observation.assetsMentioned) {
      covered.add(asset.toUpperCase());
    }
  }

  const uncovered = [...movers]
    .filter((m) => !covered.has(m.asset.toUpperCase()))
    .sort(byMagnitude)
    .slice(0, input.moverLimit ?? DEFAULT_MOVER_LIMIT)
    .map((m) => ({ asset: m.asset, changePercent: m.changePercent }));

  const titles = new Map(input.narratives.map((n) => [n.narrativeId, n.title]));
  const confirmed: ConfirmedNarrative[] = [];
  const quiet: ConfirmedNarrative[] = [];
  let unscored = 0;

  for (const observation of runObservations) {
    const score = input.scores.get(observation.narrativeId);
    const mentioned = new Set(observation.assetsMentioned.map((a) => a.toUpperCase()));
    const confirming = movers.filter((m) => mentioned.has(m.asset.toUpperCase())).sort(byMagnitude);
    const row: ConfirmedNarrative = {
      narrativeId: observation.narrativeId,
      title: titles.get(observation.narrativeId) ?? observation.narrativeId,
      score: score?.score ?? null,
      coverage: score?.coverage ?? 0,
      assets: [...observation.assetsMentioned],
      confirming,
    };
    if (row.score === null) {
      unscored++;
    } else if (confirming.length > 0) {
      confirmed.push(row);
    } else {
      quiet.push(row);
    }
  }

  const rank = (a: ConfirmedNarrative, b: ConfirmedNarrative): number =>
    (b.score ?? -1) - (a.score ?? -1) || a.narrativeId.localeCompare(b.narrativeId);
  confirmed.sort(rank);
  quiet.sort(rank);

  return {
    runId: input.runId,
    uncovered,
    confirmed,
    quiet,
    unscored,
    limits: limitsOf(runObservations, input.scores),
  };
}

/**
 * State what the run cannot measure, in plain language. A partial score that
 * does not say why it is partial reads as a complete score.
 */
function limitsOf(
  observations: readonly NarrativeObservation[],
  scores: ReadonlyMap<string, PartialScore>,
): string[] {
  const limits: string[] = [];
  const reasons = new Set<string>();
  for (const observation of observations) {
    for (const component of scores.get(observation.narrativeId)?.components ?? []) {
      if (!component.available && component.reason !== undefined) {
        reasons.add(`${component.component} (${component.reason})`);
      }
    }
  }
  if (reasons.size > 0) {
    limits.push(`unavailable this run: ${[...reasons].sort().join(", ")}`);
  }
  if (observations.length > 0 && observations[0]?.movers.length === 0) {
    limits.push("no movers were screened this run; market confirmation cannot be measured");
  }
  return limits;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Render a briefing as the text a user reads in chat. */
export function renderBriefing(briefing: Briefing): string {
  const lines = [`Resonance brief — run ${briefing.runId}`, ""];

  lines.push("OFF-RADAR MOVERS — moved hard, no narrative covers them");
  if (briefing.uncovered.length === 0) {
    lines.push("  none: every screened mover is named by a narrative this run");
  } else {
    for (const mover of briefing.uncovered) {
      lines.push(`  ${mover.asset.padEnd(10)} ${pct(mover.changePercent)}`);
    }
  }
  lines.push("");

  lines.push("CONFIRMED NARRATIVES — news and price agreeing");
  if (briefing.confirmed.length === 0) {
    lines.push("  none: no narrative this run names a screened mover");
  } else {
    for (const row of briefing.confirmed) {
      const moves = row.confirming.map((m) => `${m.asset} ${pct(m.changePercent)}`).join(", ");
      lines.push(`  ${row.score?.toFixed(3) ?? "  none"}  ${row.title}`);
      lines.push(`          ${moves}`);
    }
  }
  lines.push("");

  const quiet = briefing.quiet.length;
  lines.push(
    `${quiet} scored narrative${quiet === 1 ? "" : "s"} name no mover; ` +
      `${briefing.unscored} unscored (no tradeable asset mentioned).`,
  );
  for (const limit of briefing.limits) {
    lines.push(limit);
  }
  return lines.join("\n");
}
