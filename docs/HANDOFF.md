# Handoff

This file carries the integration agent's current milestone state so a fresh session in any client can continue without chat history. Feature agents report their own four fields in their PRs.

## Objective

Reach milestone `v0.1.0-alpha.1` — a usable, crypto-only private alpha built publicly on GitHub — by executing the branch sequence in [DESIGN.md](DESIGN.md). Six branches are merged; next is `feat/corpus-clustering` (3D).

## Current State

`main` carries six merged branches. `bootstrap/repository-base`: the repository skeleton. `spike/ten-real-candidates` (PR #1): two live runs of the full loop on keyless sources, delivering `spike/candidates/2026-08-24-ten-candidates-v2.md`. `refactor/alpha-contracts` (PR #2): the stable contracts locked in `@resonance/lib` and DESIGN.md. `feat/canonical-snapshots` (PR #3): immutable git-trackable snapshot storage with schema-0.1 gating. `feat/market-connectors` (PR #4): Binance (via `data-api.binance.vision` because the trading host answers HTTP 451 here) and Coinbase market connectors with injectable fetch, plus raw-capture persistence at `<runDir>/raw/<connectorId>.json` (deterministic, immutable, failures recorded); live smoke returned 3,684 Binance tickers and 833 Coinbase products. `feat/research-connectors` (PR #5): DefiLlama, RSS/Atom, and GitHub release connectors, with the repo list re-curated for traction (dropped `polkadot/polkadot`, swapped the frozen `solana-labs/solana` for `anza-xyz/agave`, added `paradigmxyz/reth`); Robinhood Chain is covered via DefiLlama TVL since it has no machine-readable public channel; live smoke 19/19 ok. All five fixed connector families are now merged. No snapshot data is committed yet. GitHub milestone and branch-contract issues remain uncreated (`gh` CLI restored ad hoc from keychain credentials; `ISSUES-DRAFT.md` holds the text).

## Next Action

Begin `feat/corpus-clustering` from `main`: port the spike's clustering into `@resonance/lib` against the locked contracts so merged connectors can produce a clustered document corpus; it closes wave 3. Confirm scope with the integrator before starting.

## Verification

`pnpm verify` is green on `main` after the research-connector merge (Biome clean, both packages build, typecheck clean, 48 tests pass, packed CLI answers `--help`); `pnpm install --frozen-lockfile` passes. Live smoke of the merged connectors: 19/19 research endpoints ok (DefiLlama 8,133 protocols, seven feeds, eleven repos), DefiLlama capture contains 129 protocols deployed on Robinhood Chain. On the spike branch the full pipeline ran live: 42/43 requests ok, 484 docs, 253 clusters, 215 bundles, ten v2 candidates.
