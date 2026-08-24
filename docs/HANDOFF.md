# Handoff

This file carries the integration agent's current milestone state so a fresh session in any client can continue without chat history. Feature agents report their own four fields in their PRs.

## Objective

Reach milestone `v0.1.0-alpha.1` — a usable, crypto-only private alpha built publicly on GitHub — by executing the branch sequence in [DESIGN.md](DESIGN.md). The first two branches are merged; next is `refactor/alpha-contracts`.

## Current State

`main` carries two merged branches. `bootstrap/repository-base`: the repository skeleton (pnpm workspace, pinned toolchain, strict TypeScript, Biome, Vitest, `pnpm verify` with packed-CLI smoke check, placeholder contracts and CLI, canonical docs, CI). `spike/ten-real-candidates` (PR #1): two live runs of the retrieval→normalize→cluster→evidence→candidates loop on keyless sources, the second recalibrated with alpha-shaped sources (Binance full tape, Hyperliquid positioning, stablecoin supply, alternative feeds, category lens) and an early/low-consensus rubric, delivering ten docId-traceable candidates in `spike/candidates/2026-08-24-ten-candidates-v2.md`. The connector and snapshot contracts in `packages/lib` are still placeholders; `refactor/alpha-contracts` locks the stable ones proven by the spike. GitHub milestone and branch-contract issues remain uncreated (`gh` CLI unusable in this environment; `ISSUES-DRAFT.md` holds the text).

## Next Action

Begin `refactor/alpha-contracts` from `main`: formalize in `packages/lib` the connector, document, snapshot, and evidence contracts plus the five lifecycle values, CLI exit-code conventions, deduplication rules, and evidence reference format proven by the spike, and record the locked contracts in DESIGN.md.

## Verification

`pnpm verify` is green on `main` after the spike merge (Biome clean, typecheck clean, both packages build, 6 tests pass, packed CLI answers `--help`). On the spike branch the full pipeline ran live: 42/43 requests ok, 484 docs, 253 clusters, 215 bundles, ten v2 candidates.
