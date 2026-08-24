# Status — Merged Behavior

This file describes only merged behavior on `main`. Feature-branch progress lives in its public issue and PR until merged.

## Current state: repository bootstrap

The `bootstrap/repository-base` branch establishes the minimal public repository skeleton:

- Apache-2.0 license.
- pnpm workspace with `packages/lib` (`@resonance/lib`) and `packages/cli` (`@resonance/terminal`).
- Pinned Node (`.nvmrc`) and pnpm (`packageManager`) versions.
- Strict TypeScript, Biome formatting/linting, Vitest, and `pnpm verify`.
- Placeholder connector and snapshot contracts in `@resonance/lib`.
- Placeholder CLI answering `--help` and `--version` (default with no arguments: help, exit 0; unknown command: error on stderr, exit 1).
- One fixture-based smoke test.
- One GitHub Actions workflow running `pnpm verify` on every push and pull request.

## Current state: live-data spike

The `spike/ten-real-candidates` branch (PR #1) proved the retrieval→normalize→cluster→evidence→candidates loop on live keyless sources before formal infrastructure:

- Four spike scripts under `spike/scripts/` fetch, normalize, cluster, and build bounded evidence bundles from public data (Binance, DefiLlama, Hyperliquid, stablecoin supply, seven RSS feeds, GitHub releases).
- Two live runs; the second recalibrated with alpha-shaped sources and an early/low-consensus rubric, delivering ten docId-traceable candidates in `spike/candidates/2026-08-24-ten-candidates-v2.md`.
- Spike outputs are not scored candidates, and spike scripts are not product code; the stable contracts they earned are locked on `refactor/alpha-contracts`.

## Current state: locked alpha contracts

The `refactor/alpha-contracts` branch (PR #2) replaced the bootstrap placeholders with the stable contracts in `@resonance/lib`, recorded as locked in DESIGN.md:

- Five scan lifecycle stages (`fetch`, `normalize`, `cluster`, `evidence`, `candidates`) and CLI exit codes `0`/`1`/`2`.
- Document identity (SHA-256 `contentHash`, 12-hex `docId`), eight document kinds, and deduplication rules (unique by content hash; first-write-wins on `(sourceId, url)`).
- Evidence references in `[docId]` format, connector and connector-result shapes, and snapshot schema `0.1` with structural validation.
- `pnpm verify` builds before typechecking so workspace type declarations resolve on fresh clones.

## Current state: canonical snapshot storage

The `feat/canonical-snapshots` branch (PR #3) added the immutable, git-trackable snapshot layer to `@resonance/lib`:

- Snapshots live at `<storeDir>/<runId>/snapshot.json`, serialized deterministically (sorted keys) for minimal git diffs.
- Writes enforce the locked schema `0.1`, the deduplication invariants, and a traversal-safe runId pattern; rewrites are refused.
- Reads accept only the locked schema version and fail with stable `SnapshotStoreError` codes otherwise.
- No snapshot data is committed yet; real snapshots arrive with the connector branches.

## What does not exist yet

- No product connectors, no clustering, no scoring, no research workflow, no installer, no handoff. `feat/market-connectors` and `feat/research-connectors` build the five fixed connectors against the locked contracts and the canonical store.
- No database, scheduler, embeddings, MCP, trading, or browser UI — and none are planned for the private alpha.

## Milestone progress

`v0.1.0-alpha.1` — in progress: bootstrap, the live-data spike, the locked contracts, and canonical snapshot storage are merged; no connectors, scored candidates, or repeated scans yet. See [DESIGN.md](DESIGN.md) for the branch sequence and [HANDOFF.md](HANDOFF.md) for the current integration state.
