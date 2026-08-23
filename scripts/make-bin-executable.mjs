import { chmodSync } from "node:fs";
import { join } from "node:path";

/**
 * Mark the CLI entrypoint executable after `tsc` emits it, so packed
 * tarballs carry the executable bit for the `resonance` bin.
 */
const entry = join(process.cwd(), "dist", "index.js");
chmodSync(entry, 0o755);
