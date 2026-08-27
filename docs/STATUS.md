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

## Current state: market connectors and raw captures

The `feat/market-connectors` branch (PR #4) added two of the five fixed connectors to `@resonance/lib`:

- `BinanceSpotConnector` (full 24h spot tape via `data-api.binance.vision`, the official public market-data host) and `CoinbaseSpotConnector` (product list with price and volume), both non-throwing with injectable fetch.
- `CapturingConnector`/`RawCapture` extend the locked connector interface additively; captures persist to `<runDir>/raw/<connectorId>.json` — deterministic, immutable, with failures recorded.
- Live smoke: 3,684 Binance tickers and 833 Coinbase products fetched without keys.

## Current state: research connectors, curated for traction

The `feat/research-connectors` branch (PR #5) added the last three of the five fixed connector families to `@resonance/lib` and re-curated the default repo list around chains with actual momentum:

- `DefiLlamaProtocolsConnector` (kind `tvl`), `FeedConnector` (kind `feed`, raw XML payloads, browser-like default user agent), and `GitHubReleasesConnector` (kind `repo`, one unauthenticated `releases/latest` request per repository).
- Default lists are spike-seeded and traction-curated: seven feeds, and eleven repos with `polkadot/polkadot` dropped (no releases, stagnant), the frozen `solana-labs/solana` replaced by the active validator `anza-xyz/agave`, and `paradigmxyz/reth` added.
- Robinhood Chain has no machine-readable public channel (closed-infra Arbitrum Orbit L2, no RSS); its momentum signal arrives via DefiLlama, which lists the chain and its protocols, plus the Arbitrum stack repos in the list.
- Live smoke: 19/19 research endpoints ok, including 129 protocols deployed on Robinhood Chain in the DefiLlama capture.

## What does not exist yet

- All five fixed connector families are merged; no clustering, no scoring, no research workflow, no installer, no handoff yet.
- No database, scheduler, embeddings, MCP, trading, or browser UI — and none are planned for the private alpha.

## Milestone progress

`v0.1.0-alpha.1` — in progress: bootstrap, the live-data spike, the locked contracts, canonical snapshot storage, and all five fixed connector families are merged; no scored candidates or repeated scans yet. See [DESIGN.md](DESIGN.md) for the branch sequence and [HANDOFF.md](HANDOFF.md) for the current integration state.
