# Handoff

This file carries the integration agent's current milestone state so a fresh session in any client can continue without chat history. Feature agents report their own four fields in their PRs.

## Objective

Reach milestone `v0.1.0-alpha.1` — a usable, crypto-only private alpha built publicly on GitHub — by executing the branch sequence in [DESIGN.md](DESIGN.md). Four branches are merged; next is `feat/market-connectors`, then `feat/research-connectors`.

## Current State

`main` carries four merged branches. `bootstrap/repository-base`: the repository skeleton (pnpm workspace, pinned toolchain, strict TypeScript, Biome, Vitest, `pnpm verify` with packed-CLI smoke check, canonical docs, CI). `spike/ten-real-candidates` (PR #1): two live runs of the retrieval→normalize→cluster→evidence→candidates loop on keyless sources, delivering ten docId-traceable candidates in `spike/candidates/2026-08-24-ten-candidates-v2.md`. `refactor/alpha-contracts` (PR #2): the stable contracts proven by the spike locked in `@resonance/lib` and DESIGN.md. `feat/canonical-snapshots` (PR #3): immutable git-trackable snapshot storage at `<storeDir>/<runId>/snapshot.json` with deterministic serialization, dedup-invariant enforcement, traversal-safe runIds, and strict schema-0.1 gating (`SnapshotStoreError` with stable codes); `pnpm verify` is green with 28 tests. No real snapshot data exists yet — it arrives with the connector branches. GitHub milestone and branch-contract issues remain uncreated (`gh` CLI unusable in this environment; `ISSUES-DRAFT.md` holds the text).

## Next Action

Begin `feat/market-connectors` from `main`: Binance and Coinbase market connectors implementing the locked `Connector` contract (injectable fetch for offline tests) plus the raw-capture persistence layer, writing the first real snapshots through the canonical store. Then `feat/research-connectors` (DefiLlama, RSS/Atom, GitHub).

## Verification

`pnpm verify` is green on `main` after the snapshot merge (Biome clean, both packages build, typecheck clean, 28 tests pass, packed CLI answers `--help`); `pnpm install --frozen-lockfile` passes. On the spike branch the full pipeline ran live: 42/43 requests ok, 484 docs, 253 clusters, 215 bundles, ten v2 candidates.
