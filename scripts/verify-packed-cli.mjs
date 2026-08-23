import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Bootstrap exit-criterion check: the packed CLI tarball must contain a
 * runnable `dist/index.js` that answers `--help` in a temporary directory.
 *
 * Assumes `pnpm build` already ran (the root `verify` script orders this).
 */
const tempDir = mkdtempSync(join(tmpdir(), "resonance-packed-"));

execFileSync("pnpm", ["--filter", "@resonance/terminal", "pack", "--pack-destination", tempDir], {
  stdio: "ignore",
});

const tarball = join(tempDir, "resonance-terminal-0.0.0.tgz");
execFileSync("tar", ["-xzf", tarball, "-C", tempDir], { stdio: "ignore" });

const packedEntry = join(tempDir, "package", "dist", "index.js");
const help = execFileSync(process.execPath, [packedEntry, "--help"], { encoding: "utf8" });

if (!help.includes("resonance") || !help.includes("Usage:")) {
  throw new Error("packed CLI --help output looks wrong");
}

console.log("packed CLI smoke check passed");
