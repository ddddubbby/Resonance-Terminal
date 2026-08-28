/**
 * Command handling for the scan-workflow CLI.
 *
 * Keep this module free of `process` side effects beyond stdout/stderr
 * writes so tests can exercise it without spawning a child process.
 *
 * Exit codes follow the locked contract in `@resonance/lib` (`EXIT_OK`,
 * `EXIT_ERROR`, `EXIT_DEGRADED`).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  EXIT_DEGRADED,
  EXIT_ERROR,
  EXIT_OK,
  type ExitCode,
  listRuns,
  listSnapshots,
  type PartialScore,
  promoteNarrative,
  readGrouping,
  readNarratives,
  readObservations,
  readPromotions,
  runDirOf,
  runScan,
  type ScanOptions,
  type ScanSummary,
  scoreAll,
  withAllocatedNarrativeIds,
} from "@resonance/lib";

/** CLI version. Keep in sync with packages/cli/package.json. */
export const VERSION = "0.0.0";

/** Default store directory, relative to the working directory. */
export const DEFAULT_STORE = ".resonance";

const HELP = `resonance ${VERSION}

Crypto-only narrative intelligence terminal (private alpha).

Usage:
  resonance --help                       Show this help
  resonance --version                    Show the CLI version
  resonance scan [--store DIR] [--json]  Fetch, normalize, snapshot, cluster
  resonance candidates [--store DIR] [--run ID] [--json]
                                         Scored narratives of a grouped run
  resonance status [--store DIR] [--json]
                                         Store summary: runs, narratives, scores
  resonance promote --narrative ID [--note TEXT] [--run ID] [--store DIR]
                                         Promote a narrative to the shortlist

The store defaults to ${DEFAULT_STORE}. Scans write immutable snapshots plus
run-local artifacts; grouping is agent-side (see docs/PROTOCOL.md).
`;

/** Parsed global flags. */
interface Flags {
  store: string;
  json: boolean;
  run?: string;
  narrative?: string;
  note?: string;
}

function parseFlags(args: readonly string[]): Flags | string {
  const flags: Flags = { store: DEFAULT_STORE, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--store") {
      const value = args[++i];
      if (value === undefined) {
        return "--store needs a value";
      }
      flags.store = value;
    } else if (arg === "--run") {
      const value = args[++i];
      if (value === undefined) {
        return "--run needs a value";
      }
      flags.run = value;
    } else if (arg === "--narrative") {
      const value = args[++i];
      if (value === undefined) {
        return "--narrative needs a value";
      }
      flags.narrative = value;
    } else if (arg === "--note") {
      const value = args[++i];
      if (value === undefined) {
        return "--note needs a value";
      }
      flags.note = value;
    } else {
      return `unknown flag: ${arg}`;
    }
  }
  return flags;
}

function out(message: string): void {
  process.stdout.write(message.endsWith("\n") ? message : `${message}\n`);
}

function err(message: string): void {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
}

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

/** Injectable scan plumbing so tests run fully offline. */
export interface ScanCommandDeps {
  readonly scan?: (storeDir: string, options: ScanOptions) => Promise<ScanSummary>;
}

async function scanCommand(flags: Flags, deps: ScanCommandDeps): Promise<ExitCode> {
  const runScanFn = deps.scan ?? runScan;
  try {
    const summary = await runScanFn(flags.store, {});
    const failed = summary.connectors.filter((c) => !c.ok);
    if (flags.json) {
      out(JSON.stringify(summary, null, 2));
    } else {
      out(`scan ${summary.runId}: ${summary.documents} documents, ${summary.clusters} clusters`);
      out(`snapshot: ${join(flags.store, summary.runId, "snapshot.json")}`);
      if (failed.length > 0) {
        for (const result of failed) {
          out(
            `degraded: ${result.connectorId} (${result.error ?? `HTTP ${result.status ?? "?"}`})`,
          );
        }
      }
    }
    return summary.degraded ? EXIT_DEGRADED : EXIT_OK;
  } catch (error) {
    err(`scan failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }
}

// ---------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------

interface CandidateRow {
  readonly narrativeId: string;
  readonly title: string;
  readonly score: number | null;
  readonly coverage: number;
  readonly full: boolean;
  readonly promoted: boolean;
  readonly components: PartialScore["components"];
}

function candidatesData(storeDir: string, runId: string): CandidateRow[] | string {
  const runDir = runDirOf(storeDir, runId);
  const grouping = readGrouping(runDir);
  if (grouping === null) {
    return `run ${runId} has no grouping record; run the grouping step first (docs/PROTOCOL.md)`;
  }
  const narratives = readNarratives(storeDir);
  // The on-disk grouping record may predate identity allocation; rederive it
  // deterministically (allocations ran in unmatched-group order).
  const allocated = narratives
    .filter((n) => n.establishedRunId === runId)
    .map((n) => n.narrativeId);
  const withIds = withAllocatedNarrativeIds(grouping, { allocated, matched: [] });
  const grouped = new Set(
    withIds.groups.map((g) => g.narrativeId).filter((id): id is string => id !== undefined),
  );
  const scores = scoreAll(readObservations(storeDir));
  const promoted = new Set(readPromotions(storeDir).map((p) => p.narrativeId));
  const rows: CandidateRow[] = [];
  for (const narrative of narratives) {
    if (!grouped.has(narrative.narrativeId)) {
      continue;
    }
    const score = scores.get(narrative.narrativeId);
    rows.push({
      narrativeId: narrative.narrativeId,
      title: narrative.title,
      score: score?.score ?? null,
      coverage: score?.coverage ?? 0,
      full: score?.full ?? false,
      promoted: promoted.has(narrative.narrativeId),
      components: score?.components ?? [],
    });
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return rows;
}

function renderCandidates(runId: string, rows: CandidateRow[]): string {
  if (rows.length === 0) {
    return `run ${runId}: no grouped narratives with observations yet`;
  }
  const lines = [`candidates — run ${runId}`, ""];
  for (const row of rows) {
    const score =
      row.score === null
        ? "no score"
        : `${row.score.toFixed(3)} (coverage ${row.coverage.toFixed(2)}${row.full ? ", full" : ""})`;
    lines.push(`${row.narrativeId} ${row.promoted ? "[promoted] " : ""}${row.title} — ${score}`);
    for (const component of row.components) {
      const value = component.available
        ? `${component.score?.toFixed(2) ?? "?"} (w=${component.weight.toFixed(2)})`
        : `unavailable: ${component.reason ?? "?"}`;
      lines.push(`  - ${component.component}: ${value}`);
    }
  }
  return lines.join("\n");
}

function candidatesCommand(flags: Flags): ExitCode {
  const runs = listRuns(flags.store);
  const runId = flags.run ?? runs[runs.length - 1];
  if (runId === undefined) {
    err(`no runs found in store ${flags.store}; run 'resonance scan' first`);
    return EXIT_ERROR;
  }
  const data = candidatesData(flags.store, runId);
  if (typeof data === "string") {
    out(data);
    return EXIT_OK;
  }
  if (flags.json) {
    out(JSON.stringify({ runId, candidates: data }, null, 2));
  } else {
    out(renderCandidates(runId, data));
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function statusCommand(flags: Flags): ExitCode {
  const runs = listRuns(flags.store);
  const snapshots = listSnapshots(flags.store);
  const narratives = readNarratives(flags.store);
  const observations = readObservations(flags.store);
  const promotions = readPromotions(flags.store);
  const latest = runs[runs.length - 1];
  const latestRunDir = latest !== undefined ? runDirOf(flags.store, latest) : undefined;
  const status = {
    store: flags.store,
    runs: runs.length,
    snapshots: snapshots.length,
    narratives: narratives.length,
    observations: observations.length,
    promotions: promotions.length,
    latestRun: latest ?? null,
    latestRunHasGrouping:
      latestRunDir !== undefined && existsSync(join(latestRunDir, "grouping.json")),
    latestRunHasEvidence: latestRunDir !== undefined && existsSync(join(latestRunDir, "evidence")),
  };
  if (flags.json) {
    out(JSON.stringify(status, null, 2));
  } else {
    out(`store: ${flags.store}`);
    out(`runs: ${status.runs} | snapshots: ${status.snapshots}`);
    out(
      `narratives: ${status.narratives} | observations: ${status.observations} | promotions: ${status.promotions}`,
    );
    out(
      status.latestRun === null
        ? "no runs yet; run 'resonance scan' first"
        : `latest run: ${status.latestRun} (grouping: ${status.latestRunHasGrouping ? "yes" : "no"}, evidence: ${status.latestRunHasEvidence ? "yes" : "no"})`,
    );
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// promote
// ---------------------------------------------------------------------------

function promoteCommand(flags: Flags): ExitCode {
  if (flags.narrative === undefined) {
    err("promote needs --narrative ID");
    return EXIT_ERROR;
  }
  try {
    const promotion = promoteNarrative(flags.store, {
      narrativeId: flags.narrative,
      ...(flags.run !== undefined ? { runId: flags.run } : {}),
      ...(flags.note !== undefined ? { note: flags.note } : {}),
    });
    out(`promoted ${promotion.narrativeId} at ${promotion.promotedAt}`);
    return EXIT_OK;
  } catch (error) {
    err(`promote failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }
}

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

/**
 * Run the CLI against the given arguments (without `process.argv[0]`/
 * `argv[1]`). Resolves to the process exit code.
 */
export async function run(argv: readonly string[], deps: ScanCommandDeps = {}): Promise<ExitCode> {
  const first = argv[0];
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    out(HELP);
    return EXIT_OK;
  }
  if (first === "--version" || first === "-v") {
    out(VERSION);
    return EXIT_OK;
  }
  const command = first;
  const rest = argv.slice(1);
  const flags = parseFlags(rest);
  if (typeof flags === "string") {
    err(`resonance ${command}: ${flags}\nRun 'resonance --help' for usage.`);
    return EXIT_ERROR;
  }
  switch (command) {
    case "scan":
      return scanCommand(flags, deps);
    case "candidates":
      return candidatesCommand(flags);
    case "status":
      return statusCommand(flags);
    case "promote":
      return promoteCommand(flags);
    default:
      err(`resonance: unknown command or flag: ${command}\nRun 'resonance --help' for usage.`);
      return EXIT_ERROR;
  }
}
