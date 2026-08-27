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
| 3D | `feat/corpus-clustering` | Lexical pre-grouping and deduplication input for grouping |
| 4A | `feat/partial-scoring` | Time-series metrics, cold start, coverage, full/partial scores; components attach to narratives, not scans |
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

Rules: every manual scan adds a time-series observation; attention-derived components stay unavailable until three successful scans span at least seven calendar days; available components are reweighted into a partial score with explicit coverage; full scores require every component. Components attach to narratives (see the narrative granularity section); scan-level observations are interim infrastructure, not the scored unit.

## Contract status

The contracts below were proven by `spike/ten-real-candidates` and are **locked** in `packages/lib` (`@resonance/lib`, schema version `0.1`). No implementation branch may redefine them without a separately approved directional PR.

- **Scan lifecycle** — five stages, in order: `fetch`, `normalize`, `cluster`, `evidence`, `candidates`. Every scan runs all five.
- **CLI exit codes** — `0` success (tolerated source failures are recorded, never fatal), `1` hard error (invalid usage, contract violation, fatal pipeline failure), `2` degraded success (completed with recorded source failures).
- **Document identity** — `contentHash` is SHA-256 of `sourceId|kind|url|title|text`; `docId` is its first 12 hex characters. Document kinds: `news`, `release`, `market`, `mover`, `tvl`, `positioning`, `positioning-spot`, `stablecoin` (the spike's `hyperliquid` kinds generalize to the `positioning` pair).
- **Deduplication** — documents are unique by `contentHash`; on `(sourceId, url)` collisions the first write wins, and producers must give every document a distinct URL.
- **Evidence reference format** — `[docId]`, a bracketed 12-hex docId. Evidence bundles carry their documents plus per-source counts.
- **Snapshot schema** — version `0.1`: `schemaVersion`, `runId`, `createdAt`, one connector result per attempted connector (successes and recorded failures), and the deduplicated documents.
- **Connectors** — `id`, `kind` (`market`, `tvl`, `feed`, `repo`, `positioning`, `stablecoin`), and a `fetch` returning a recorded result. Raw-capture persistence belongs to the snapshot layer, not the connector.

## Narrative granularity

Supersedes the earlier "Clustering stage decisions". Measured on the spike corpus (240 textual documents, 28,680 pairs, re-audited on the shipped implementation): 99.6% of pairs score below 0.16; the 106 pairs above threshold show 100% same-event precision at the top, all proper-noun-driven events (a licensing win, a protocol incident, a flow report). Lexical similarity captures genuine cross-source events yet is structurally blind to paraphrased same-event coverage, and 7 independent feeds in one fetch mostly cover different stories. Recorded as stage policy, not locked schema:

- **Lexical clustering is demoted to deduplication and context reduction.** It is a high-precision pre-grouping pass feeding the grouping step, never the narrative decision-maker. The merged module keeps this role; do not tune its threshold as if it governed narrative identity.
- **Event grouping is agent-side in v1.** The grouping step reads the textual corpus with the lexical pre-groups as hints and produces groups with written rationale, stamped with model and rules version. Interpretation is recorded as interpretation; determinism is not objectivity, and a hardcoded threshold is a judgment call wearing a lab coat — the accountable form states its reasoning.
- **The event-to-theme bridge is an explicit layer, not an emergent property.** The product sells themes spanning weeks and many non-overlapping events; stage three produces events. Narrative identity persists across runs in this layer. This supersedes the run-local cluster decision: cluster ids stay run-local, but narrative identity must not be.
- **The corpus accumulates across runs.** Same-event overlap inside one fetch is too sparse to measure resonance (~28 genuine cross-source pairs among 28,680). Grouping and theme matching operate over an accumulating window; per-scan independent clustering is retired.
- **Only `news` and `release` documents participate in grouping.** The structured kinds (`market`, `mover`, `tvl`, `positioning`, `positioning-spot`, `stablecoin`) carry no text semantics and feed metrics directly.
- **Reproducibility restated.** The lexical pass stays deterministic (same input, same output, traceable). Agent grouping and narrative identity are versioned interpretations: reproducible by record (inputs, model, rules version, rationale), not bit-stable.

## Scoring stage decisions

Recorded with the reworked `feat/partial-scoring`, under the approved scoring direction and the narrative-granularity revision above. Implementation policy; it does not redefine either:

- **The scored unit is the narrative.** Every manual scan records one observation per narrative it covers; the cold-start gate applies to each narrative's own series.
- **Component split.** `momentum`, `novelty`, `breadth`, and `unsaturation` are the attention-derived components gated by the cold-start rule; `marketConfirmation` and `investability` are measurable from a single scan.
- **Honest availability.** A component lacking its required inputs is recorded as unavailable with a reason, never scored as zero. The partial score reweights the available components; coverage is the sum of available weights; a full score requires all six.
- **The time series is an append-only ledger** at `<storeDir>/observations.json` (own schema `0.1`), one observation per narrative per manual scan — a derived artifact outside the locked snapshot schema, like clustering.
- **Grouping records are run-local derived views** at `<runDir>/grouping.json` (own schema `0.1`): agent-produced event groups with written rationale and a model/rules stamp, one-event membership per document. The narrative ledger lives at `<storeDir>/narratives.json` (own schema `0.1`); identity allocation is deterministic and library-side, matching a group to an existing narrative is agent-side interpretation.
- **Metric formulas are deterministic and monotone, versioned with the library.** Recalibrating any formula is a score-rule change requiring an approved PR.
- **Connectors stay source-neutral and never fill `asset`.** The scan stage resolves mentions with the library's `resolveMentions` (rules version `1`, a deliberately small seed vocabulary). Extending the vocabulary is a versioned change.

## Publication policy

- GitHub publication happens immediately after `bootstrap/repository-base` passes locally; the branch is pushed as `main`.
- One GitHub issue is created for every branch contract above; work proceeds through short-lived public PRs.
- The npm package stays unpublished until the private-alpha release gate; local packed installations are used before then.
- No CODEOWNERS, branch protection, release automation, or contributor governance yet.
- Pull requests that change product behavior, canonical schemas, score rules, source policy, public CLI commands, or agent handoff behavior require human approval. The primary integration agent may merge green implementation PRs that conform to an approved contract.
