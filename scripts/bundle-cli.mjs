import { chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildSync } from "esbuild";

/**
 * Bundle the CLI into a single self-contained `dist/index.js`.
 *
 * The packed-tarball smoke check (scripts/verify-packed-cli.mjs) runs the
 * CLI from an isolated temp directory where `@resonance/lib` does not
 * exist, so the workspace dependency must be bundled in. tsc still runs
 * first to emit the declaration-checked module graph; this step then
 * collapses it into one executable entrypoint.
 */
rmSync(join(process.cwd(), "dist"), { recursive: true, force: true });

buildSync({
  entryPoints: [join(process.cwd(), "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(process.cwd(), "dist", "index.js"),
  banner: { js: "#!/usr/bin/env node" },
});

chmodSync(join(process.cwd(), "dist", "index.js"), 0o755);
