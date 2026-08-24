# Handoff

This file carries the integration agent's current milestone state so a fresh session in any client can continue without chat history. Feature agents report their own four fields in their PRs.

## Objective

Reach milestone `v0.1.0-alpha.1` — a usable, crypto-only private alpha built publicly on GitHub — by executing the branch sequence in [DESIGN.md](DESIGN.md). The first three branches are merged; next is wave 3, starting with `feat/canonical-snapshots`.

## Current State

`main` carries three merged branches. `bootstrap/repository-base`: the repository skeleton (pnpm workspace, pinned toolchain, strict TypeScript, Biome, Vitest, `pnpm verify` with packed-CLI smoke check, canonical docs, CI). `spike/ten-real-candidates` (PR #1): two live runs of the retrieval→normalize→cluster→evidence→candidates loop on keyless sources, delivering ten docId-traceable candidates in `spike/candidates/2026-08-24-ten-candidates-v2.md`. `refactor/alpha-contracts` (PR #2): the stable contracts proven by the spike are locked in `@resonance/lib` and recorded in DESIGN.md — five lifecycle stages, exit codes 0/1/2, document identity (SHA-256 contentHash, 12-hex docId), eight document kinds, deduplication rules, `[docId]` evidence references, and snapshot schema 0.1. `pnpm verify` runs build-before-typecheck so workspace declarations resolve on fresh clones. GitHub milestone and branch-contract issues remain uncreated (`gh` CLI unusable in this environment; `ISSUES-DRAFT.md` holds the text).

## Next Action

Begin wave 3 from `main`, starting with `feat/canonical-snapshots` (git-tracked snapshot storage, deduplication, schema versioning); `feat/market-connectors` and `feat/research-connectors` may follow in parallel since all three build against the locked contracts.

## Verification

`pnpm verify` is green on `main` after the contract merge (Biome clean, both packages build, typecheck clean, 18 tests pass — including 12 contract tests — packed CLI answers `--help`); `pnpm install --frozen-lockfile` passes. On the spike branch the full pipeline ran live: 42/43 requests ok, 484 docs, 253 clusters, 215 bundles, ten v2 candidates.
