# Handoff

This file carries the integration agent's current milestone state so a fresh session in any client can continue without chat history. Feature agents report their own four fields in their PRs.

## Objective

Reach milestone `v0.1.0-alpha.1` — a usable, crypto-only private alpha built publicly on GitHub — by executing the branch sequence in [DESIGN.md](DESIGN.md). Five branches are merged; next is `feat/research-connectors`.

## Current State

`main` carries five merged branches. `bootstrap/repository-base`: the repository skeleton. `spike/ten-real-candidates` (PR #1): two live runs of the full loop on keyless sources, delivering `spike/candidates/2026-08-24-ten-candidates-v2.md`. `refactor/alpha-contracts` (PR #2): the stable contracts locked in `@resonance/lib` and DESIGN.md. `feat/canonical-snapshots` (PR #3): immutable git-trackable snapshot storage with schema-0.1 gating. `feat/market-connectors` (PR #4): Binance (via `data-api.binance.vision` because the trading host answers HTTP 451 here) and Coinbase market connectors with injectable fetch, plus raw-capture persistence at `<runDir>/raw/<connectorId>.json` (deterministic, immutable, failures recorded); live smoke returned 3,684 Binance tickers and 833 Coinbase products. No snapshot data is committed yet; the research connectors are the last of the fixed five. GitHub milestone and branch-contract issues remain uncreated (`gh` CLI unusable in this environment; `ISSUES-DRAFT.md` holds the text).

## Next Action

Begin `feat/research-connectors` from `main`: DefiLlama protocols, the seven RSS feeds, and the curated GitHub release feeds proven by the spike, reusing the capture layer; then `feat/corpus-clustering` (3D) closes wave 3.

## Verification

`pnpm verify` is green on `main` after the market-connector merge (Biome clean, both packages build, typecheck clean, 39 tests pass, packed CLI answers `--help`); `pnpm install --frozen-lockfile` passes. On the spike branch the full pipeline ran live: 42/43 requests ok, 484 docs, 253 clusters, 215 bundles, ten v2 candidates.
