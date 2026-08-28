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
| 4B | `feat/agent-research-workflow` | Evidence packs and narrative research protocol (`docs/PROTOCOL.md`) |
| 4C | `feat/cli-scan-workflow` | Scan, candidates, status, promotion, JSON output; lib normalize/scan/promotions |
| 5 | `feat/agent-install-and-handoff` | One-command installation and Codex/Claude handoff |
| 6 | `test/private-alpha-e2e` | Complete workflow integration and live smoke |
| 7 | `release/v0.1.0-alpha.1` | Soak results, status, version, tag |
| 8 | `fix/alpha-security-blockers` | Snapshot identity recompute, run-id traversal guard, payload validation, response budget |
| 9 | `feat/asset-resolution` | Fix mention resolution (versioned change owed since the release's known limitations) and add the run briefing |

Rows 8 onward are post-release branches against the merged milestone, not part of the approved `v0.1.0-alpha.1` sequence; they ship in `v0.1.0-alpha.2`.

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
- **Connectors stay source-neutral and never fill `asset`.** The scan stage resolves mentions with the library's `resolveMentions`. Rules version `1`'s deliberately small seed vocabulary was extended to rules version `2` as the versioned change flagged here and in the release's known limitations — see "Asset resolution and the run briefing" below.

## CLI workflow decisions

Recorded with `feat/cli-scan-workflow`. Implementation policy; it does not redefine the locked snapshot schema, exit codes, or the research protocol:

- **A scan is fetch, normalize, snapshot, cluster — nothing more.** Grouping stays agent-side per the protocol; the CLI never writes grouping records or observations.
- **The run directory is the snapshot directory.** Snapshots live at `<storeDir>/<runId>/snapshot.json`, so raw captures (`raw/`), clustering (`clusters.json`), grouping (`grouping.json`), and evidence (`evidence/`) all sit beside the snapshot. The default store is `.resonance`; `--store` overrides.
- **Exit semantics reuse the locked contract.** `0` clean scan; `2` degraded (some connectors failed but the snapshot was written); `1` error (nothing usable). Every command answers `--json` with the same data as its human-readable output.
- **Normalization rebuilds the spike's rules on the locked identity.** Document identity is the locked content hash, deduplication the locked rules; structured numbers stay in the text. Mover screening is exported separately (`screenMovers`) as the `movers` input for scoring.
- **Candidates read what exists, honestly.** `candidates` requires a grouping record for the run; without one it says so. Identity allocation is rederived deterministically (`withAllocatedNarrativeIds`) so on-disk records predating allocation still resolve.
- **Promotion is an operator decision, not a score threshold.** `<storeDir>/promotions.json` (own schema `0.1`) is append-only, one promotion per narrative, validated against the narrative ledger.

## Asset resolution and the run briefing

Recorded with `feat/asset-resolution`, the versioned vocabulary change the
release's known limitations already owed. Implementation policy under the
scoring stage decisions above; it does not redefine the six components or
their weights.

Measured on the unchanged `2026-08-28T13-48-29` live snapshot: every one of
28 grouped narratives scored `0.000` or `none` before this branch, and none
could have scored otherwise. Three stacked defects in mention resolution
guaranteed it:

- The vocabulary (`KNOWN_ASSETS_V1`) was nine hardcoded strings against a
  932-symbol tradeable universe captured the same run.
- Matching was raw substring, so `"Ethena"` matched `eth` — the ENA-buyback
  narrative resolved to `eth`, not `ENA`.
- `marketConfirmation` and `investability` compared lowercase resolved names
  against uppercase exchange tickers, so the only two ungated components —
  the only two that can score on a first run — could not be non-zero.

**Resolution now derives its vocabulary from the snapshot** (rules version
`2`, `packages/lib/src/assets.ts`) instead of a literal: `market` documents
supply the tradeable universe, `tvl` documents supply protocol-name aliases
(DefiLlama's `Ethena USDe` row yields the `ethena → ENA` alias). The
canonical key is the uppercase ticker everywhere. Matching is word-boundary
and longest-alias-wins over tokenized text; an explicit deny list (venue
names, English-word tickers) was built by measuring which aliases
mis-resolved real documents in the corpus above, not by guesswork. Against
the same unchanged snapshot: 18 of 28 narratives now score; the ENA
narrative goes `0.000` → `0.667`.

Separately, `mover` documents were being deduplicated away by the `market`
row for the same asset — both carried the same URL, and deduplication is
first-write-wins on `(sourceId, url)`. This is why
`evidence/reference-alpha-signals.md` rendered empty on every run. Mover
documents now carry a distinct URL.

**The run briefing is a new protocol step** (`docs/PROTOCOL.md` step 6,
`resonance brief`): off-radar movers (screened movers no narrative mentions)
ranked by magnitude, then confirmed narratives (resolved assets among the
movers) ranked by score, then a plain statement of what the run could not
measure. `AGENTS.md` requires the agent to present it after every scan — a
scan that writes artifacts and reports only that files exist has not
completed. `candidates` now shows its top 10 by default (`--all`,
`--components` restore full detail); it previously printed all 28
narratives with all seven component lines each, which read as noise
however good the ranking was.

Known ambiguity accepted for now: `optimism` resolves to `OP` even though
the word appears in ordinary market commentary; kept because the chain
reading dominates in a crypto corpus. If a later run shows false positives
from it, it joins the deny list.

## Publication policy

- GitHub publication happens immediately after `bootstrap/repository-base` passes locally; the branch is pushed as `main`.
- One GitHub issue is created for every branch contract above; work proceeds through short-lived public PRs.
- The npm package stays unpublished until the private-alpha release gate; local packed installations are used before then.
- No CODEOWNERS, branch protection, release automation, or contributor governance yet.
- Pull requests that change product behavior, canonical schemas, score rules, source policy, public CLI commands, or agent handoff behavior require human approval. The primary integration agent may merge green implementation PRs that conform to an approved contract.
