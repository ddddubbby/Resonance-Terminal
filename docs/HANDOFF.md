# Handoff

This file carries the integration agent's current milestone state so a fresh session in any client can continue without chat history. Feature agents report their own four fields in their PRs.

## Objective

Reach milestone `v0.1.0-alpha.1` — a usable, crypto-only private alpha built publicly on GitHub — by executing the branch sequence in [DESIGN.md](DESIGN.md). Seven branches are merged; next is `feat/partial-scoring` (4A).

## Current State

`main` carries seven merged branches. `bootstrap/repository-base`: the repository skeleton. `spike/ten-real-candidates` (PR #1): two live runs of the full loop on keyless sources, delivering `spike/candidates/2026-08-24-ten-candidates-v2.md`. `refactor/alpha-contracts` (PR #2): the stable contracts locked in `@resonance/lib` and DESIGN.md. `feat/canonical-snapshots` (PR #3): immutable git-trackable snapshot storage with schema-0.1 gating. `feat/market-connectors` (PR #4): Binance (via `data-api.binance.vision` because the trading host answers HTTP 451 here) and Coinbase market connectors with injectable fetch, plus raw-capture persistence at `<runDir>/raw/<connectorId>.json` (deterministic, immutable, failures recorded); live smoke returned 3,684 Binance tickers and 833 Coinbase products. `feat/research-connectors` (PR #5): DefiLlama, RSS/Atom, and GitHub release connectors, with the repo list re-curated for traction (dropped `polkadot/polkadot`, swapped the frozen `solana-labs/solana` for `anza-xyz/agave`, added `paradigmxyz/reth`); Robinhood Chain is covered via DefiLlama TVL since it has no machine-readable public channel; live smoke 19/19 ok. All five fixed connector families are now merged. `feat/corpus-clustering` (PR #6): the corrected clustering stage in `@resonance/lib` — exact cosine against term-sum centroids, news/release-only corpus, numeric bucketing, threshold recalibrated to 0.16 on the spike corpus; cross-source cluster share rose from 41.7%/11.9% to 75.7%/16.8%. Clusters are run-local derived views persisted as `<runDir>/clusters.json` with versioned configuration embedded (DESIGN.md records the stage-three decisions); the locked snapshot schema is untouched. No snapshot data is committed yet. GitHub milestone and branch-contract issues remain uncreated (`gh` CLI restored ad hoc from keychain credentials; `ISSUES-DRAFT.md` holds the text).

## Next Action

Begin `feat/partial-scoring` from `main`: time-series observations per manual scan, the three-scan/seven-day cold-start gate for attention components, explicit coverage, and partial/full scores under the approved component weights in DESIGN.md; it consumes `crossSourceShare` and the structured document kinds that 3D left for metrics.

## Verification

`pnpm verify` is green on `main` after the clustering merge (Biome clean, both packages build, typecheck clean, 63 tests pass, packed CLI answers `--help`); `pnpm install --frozen-lockfile` passes. Live smoke of the merged connectors: 19/19 research endpoints ok; clustering quality gate measured 75.7%/16.8% cross-source share on the spike corpus. On the spike branch the full pipeline ran live: 42/43 requests ok, 484 docs, 253 clusters, 215 bundles, ten v2 candidates.
