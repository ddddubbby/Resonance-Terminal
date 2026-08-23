/**
 * Placeholder CLI entrypoint for the bootstrap repository.
 *
 * Real commands (`init`, `scan`, `candidates`, `promote`, `narrative`,
 * `investigate`, `status`, `handoff`, `verify`) land on later feature
 * branches. This module only wires argument handling to the process
 * exit code so the packed binary can be smoke-tested.
 */
import { run } from "./cli.js";

process.exitCode = run(process.argv.slice(2));
