/**
 * Placeholder command handling for the bootstrap CLI.
 *
 * Keep this module free of `process` side effects beyond stdout/stderr
 * writes so tests can exercise it without spawning a child process.
 */

/** CLI version. Keep in sync with packages/cli/package.json. */
export const VERSION = "0.0.0";

const HELP = `resonance ${VERSION}

Crypto-only narrative intelligence terminal (private alpha bootstrap).

Usage:
  resonance --help        Show this help
  resonance --version     Show the CLI version

Commands arrive in later milestone branches (scan, candidates, status, ...).
See docs/DESIGN.md for the branch sequence.
`;

/**
 * Run the placeholder CLI against the given arguments (without
 * `process.argv[0]`/`argv[1]`). Returns the process exit code.
 */
export function run(argv: readonly string[]): number {
  const first = argv[0];
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (first === "--version" || first === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  process.stderr.write(
    `resonance: unknown command or flag: ${first}\nRun 'resonance --help' for usage.\n`,
  );
  return 1;
}
