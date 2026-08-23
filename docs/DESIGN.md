# Design — Approved Direction

This document records approved direction and contracts. It changes only through approved directional PRs. For what actually exists today, see [STATUS.md](STATUS.md).

## Milestone: `v0.1.0-alpha.1` — Usable Private Alpha

A usable, crypto-only private alpha built publicly on GitHub that proves the complete loop:

1. Install locally through Codex or Claude Code without API keys.
2. Run five fixed public-data connectors (Binance, Coinbase, DefiLlama, RSS/Atom, GitHub).
3. Create an immutable snapshot.
4. Produce ten evidence-backed narrative candidates from real data.
5. Repeat at least three scans across seven days.
6. Show changes and calculate attention-derived metrics from accumulated observations.
7. Publish full or explicitly labeled partial scores.
8. Hand the workspace between Codex and Claude without losing direction or state.

**Non-goals:** equities, commodities, WorkBuddy, X integration, scheduling, a database, local embeddings, MCP, trading, or a browser UI.

## Branch sequence

| Order | Branch | Purpose |
| --- | --- | --- |
| 0 | `bootstrap/repository-base` | Minimal public repository skeleton |
| 1 | `spike/ten-real-candidates` | Ten candidates from live data before formalizing infrastructure |
| 2 | `refactor/alpha-contracts` | The smallest stable interfaces proven by the spike |
| 3A | `feat/canonical-snapshots` | Git-tracked snapshots, deduplication, schema versioning |
| 3B | `feat/market-connectors` | Binance and Coinbase market connectors |
| 3C | `feat/research-connectors` | DefiLlama, RSS/Atom, GitHub connectors |
| 3D | `feat/corpus-clustering` | TF-IDF, cosine similarity, preliminary clusters |
| 4A | `feat/partial-scoring` | Time-series metrics, cold start, coverage, full/partial scores |
| 4B | `feat/agent-research-workflow` | Evidence packs and narrative research protocol |
| 4C | `feat/cli-scan-workflow` | Scan, candidates, status, promotion, JSON output |
| 5 | `feat/agent-install-and-handoff` | One-command installation and Codex/Claude handoff |
| 6 | `test/private-alpha-e2e` | Complete workflow integration and live smoke |
| 7 | `release/v0.1.0-alpha.1` | Soak results, status, version, tag |

Branches in the same numbered wave may run in parallel. Later waves must not begin against speculative contracts.

## Approved scoring direction

| Component | Weight |
| --- | --- |
| Momentum | 30% |
| Novelty | 20% |
| Breadth | 15% |
| Unsaturation | 15% |
| Market Confirmation | 10% |
| Investability | 10% |

Rules: every manual scan adds a time-series observation; attention-derived components stay unavailable until three successful scans span at least seven calendar days; available components are reweighted into a partial score with explicit coverage; full scores require every component.

## Contract status

- The connector and snapshot contracts in `packages/lib/src/index.ts` are **placeholders**. The stable contracts are formalized on `refactor/alpha-contracts` (branch 2) and locked in this document at that point.
- CLI exit-code conventions, deduplication rules, evidence reference format, and the five lifecycle values are locked together with those contracts.
- No implementation branch may redefine these contracts without a separately approved directional PR.

## Publication policy

- GitHub publication happens immediately after `bootstrap/repository-base` passes locally; the branch is pushed as `main`.
- One GitHub issue is created for every branch contract above; work proceeds through short-lived public PRs.
- The npm package stays unpublished until the private-alpha release gate; local packed installations are used before then.
- No CODEOWNERS, branch protection, release automation, or contributor governance yet.
- Pull requests that change product behavior, canonical schemas, score rules, source policy, public CLI commands, or agent handoff behavior require human approval. The primary integration agent may merge green implementation PRs that conform to an approved contract.
