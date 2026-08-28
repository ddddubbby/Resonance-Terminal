#!/bin/sh
# One-command installation for Resonance Terminal (private alpha).
#
# No API keys are required anywhere. The script is idempotent: safe to
# re-run after pulling new commits. It installs exact dependencies,
# builds both packages, and gates the result with `pnpm verify` — the
# same check CI runs — finishing with a smoke run of the packed CLI.
#
# Usage (from the repository root, or from anywhere):
#   ./scripts/install.sh

set -eu

cd "$(dirname "$0")/.."

echo "==> Resonance Terminal installer"

# --- 1. Node ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install Node 22 (the version pinned in .nvmrc)." >&2
  exit 1
fi
NODE_MAJOR=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "error: Node 22+ required, found $(node --version)." >&2
  exit 1
fi
echo "node: $(node --version)"

# --- 2. pnpm ---------------------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found; enabling it via corepack..."
  corepack enable
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm unavailable. Run 'corepack enable' or install pnpm 10." >&2
  exit 1
fi
echo "pnpm: $(pnpm --version)"

# --- 3. Dependencies (exact) -----------------------------------------------
echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

# --- 4. Build + full verification gate --------------------------------------
echo "==> pnpm verify (lint, build, typecheck, tests, packed-CLI smoke)"
pnpm verify

echo ""
echo "==> Install complete. No API keys are required."
echo "Next:"
echo "  node packages/cli/dist/index.js --help    Show the CLI"
echo "  node packages/cli/dist/index.js scan      Run a scan (writes .resonance/)"
echo "  docs/PROTOCOL.md                          The scan protocol (agent-side steps)"
