/**
 * CLI entrypoint for the scan-workflow terminal.
 *
 * Argument handling lives in `cli.ts`; this module only wires it to the
 * process exit code so the packed binary can be smoke-tested.
 */
import { run } from "./cli.js";

process.exitCode = await run(process.argv.slice(2));
