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

## Current state: corrected corpus clustering

The `feat/corpus-clustering` branch (PR #6) delivered stage three of the scan lifecycle in `@resonance/lib`, correcting the four measured defects of the spike prototype:

- Exact cosine against term-sum centroids (the spike's centroids inflated to norm 1.248), news/release-only corpus (structured kinds feed metrics), numeric tokens bucketed like `0x` addresses, and threshold recalibrated to 0.16 on the spike corpus.
- Cross-source cluster share rose from the spike baseline of 41.7% / 11.9% to 75.7% of multi-doc clusters and 16.8% of all clusters; `crossSourceShare()` ships as the reusable resonance metric.
- Clusters are run-local derived views, persisted as `<runDir>/clusters.json` with versioned configuration embedded; the locked snapshot schema is untouched. DESIGN.md records the stage-three decisions (run-local identity, deterministic versus stable).

## Current state: narrative granularity revision

`direction/narrative-granularity` (PR #7) superseded the clustering-stage decisions after measurement on the shipped implementation (240 textual documents, 28,680 pairs: 99.6% below threshold; top pairs 100% genuine proper-noun events, blind to paraphrase):

- Lexical clustering is demoted to deduplication and context reduction; the merged module keeps this role.
- Event grouping is agent-side in v1, with written rationale and model/rules stamps — interpretation recorded as interpretation.
- An explicit event-to-theme layer owns narrative identity across runs (superseding run-local clusters), and the corpus accumulates across runs.

## Current state: narrative-level scoring

The reworked `feat/partial-scoring` branch (PR #8) delivered stage four under that direction:

- `grouping.ts`: the agent-side grouping step's record shapes (`<runDir>/grouping.json`, own schema 0.1, written rationale, model/rules stamp, one-event membership per document) and `preGroupHints()` — the clustering module in its demoted context-reduction role.
- `narratives.ts`: the event-to-theme layer. `<storeDir>/narratives.json` holds stable narrative identities (`n0001`…) with deterministic library-side allocation, agent-side matching, and established/lastSeen run tracking.
- Narrative-level partial scoring: one `NarrativeObservation` per narrative per scan (`<storeDir>/observations.json`), the cold-start gate applied per narrative series, the six locked weights, honest availability, explicit coverage — a full score requires all six components.
- End-to-end smoke on the spike corpus: 37 lexical hints, identities allocated and matched across runs, the gate opening at coverage 1.00 with every component honestly reported.

## Current state: the research workflow

The `feat/agent-research-workflow` branch (PR #9) delivered stage four's protocol layer:

- `research.ts`: evidence packs (one per grouped narrative — identity, theme, groups with written rationale, bounded excerpts, an untrusted-data warning, the partial score when available) plus market/TVL/alpha-signal reference sheets and `writeEvidencePacks` into `<runDir>/evidence/`.
- `withAllocatedNarrativeIds`: the deterministic bridge reattaching allocated narrative identities to unmatched groups after ledger application.
- `docs/PROTOCOL.md`: the normative five-step scan record — grouping as agent-side interpretation (rationale, model/rules stamps), identity allocation, observation, evidence, and scoring as deterministic; failure modes; and the reproducibility split (bit-stable artifacts vs versioned interpretations).

## Current state: the CLI scan workflow

The `feat/cli-scan-workflow` branch (PR #10) delivered stage 4C — the terminal's operator workflow behind the packed CLI:

- `normalize.ts`: the spike's proven normalization rules rebuilt on the locked contracts — RSS/Atom extraction, HTML stripping, per-connector document builders, mover screening for scoring, and deduplication via the locked contentHash.
- `scan.ts`: one scan = fetch → normalize → snapshot → cluster. The run directory is the snapshot directory, so `raw/`, `clusters.json`, `grouping.json`, and `evidence/` sit beside `snapshot.json`. Locked exit semantics: `0` clean, `2` degraded (snapshot written, a connector failed), `1` when no documents.
- `promotions.ts`: an append-only promotion ledger — promotion is an operator decision recorded in a ledger, never a score threshold.
- CLI commands `scan`/`candidates`/`status`/`promote` with `--store` and `--json`; `candidates` rederives allocated narrative identities deterministically and reports honest availability. Grouping stays agent-side per the protocol; the CLI never writes grouping records or observations.
- Build change: the packed CLI is esbuild-bundled into a single `dist/index.js` (with shebang) because the tarball smoke check runs from an isolated temp directory; tsc still gates the build.

## Current state: installation and agent handoff

The `feat/agent-install-and-handoff` branch (PR #11) delivered stage 5, closing milestone loop items 1 and 8:

- `scripts/install.sh`: an idempotent one-command installer — Node 22 and pnpm 10 checks (corepack fallback), exact dependencies (`--frozen-lockfile`), and the full `pnpm verify` gate. No API keys are required anywhere; installation through a coding agent runs the same script.
- `resonance handoff [--store DIR] [--json]`: the deterministic agent-to-agent handoff document — the canonical docs to read first, the store summary (runs, narratives, observations, promotions, latest-run completeness), the narrative table with honest scores, and the protocol reminders. It writes nothing; the receiving agent reads AGENTS.md, then the handoff text, then continues.
- `docs/PROTOCOL.md` records the handoff protocol: the handoff document is a rendering of store state, never edited by hand, with disagreements resolved in the store's favor. README carries the truthful installation and command reference.

## Current state: end-to-end integration and live smoke

The `test/private-alpha-e2e` branch (PR #12) delivered stage 6 — proof that the complete protocol runs end-to-end on the merged pipeline:

- `packages/cli/test/e2e.test.ts`: an offline integration suite wiring the full protocol (scan, agent-side grouping, narrative identity, observations, evidence packs, scoring, promotion, handoff) with two fake connectors (an RSS feed pair and the Binance tape) and an injected clock. Nothing else is stubbed.
- Three scans span fifteen days, so the per-narrative cold-start gate (3 observations over >= 7 days) opens honestly inside the suite: attention components report `cold-start` before the gate, all six components are available after.
- The CLI is exercised on top of the populated store: `status --json`, `candidates`, `promote`, `handoff`; run artifacts (`snapshot.json`, `grouping.json`, `clusters.json`, `raw/`, evidence packs) are asserted to sit beside their snapshot.
- A live smoke (not committed) ran the same chain twice on real endpoints: 24/24 connectors ok per scan, 242 textual documents, 20 agent-grouped narratives with written rationale (`n0001`-`n0020`), 20 observations, 20 evidence packs, and the full CLI chain. Scoring is honest: marketConfirmation/investability score zero where the seed known-asset vocabulary has no overlap with screened movers - a known versioned limitation, not a defect.

## Current state: the private alpha release

The `release/v0.1.0-alpha.1` branch (PR #13) cut the private alpha, tagged `v0.1.0-alpha.1` on `main`:

- Version `0.1.0-alpha.1` across the root package, `@resonance/lib`, `@resonance/terminal`, and the CLI `VERSION` constant; the packed smoke check reads the tarball name from the CLI package instead of hardcoding it.
- `docs/RELEASE-NOTES.md` records the milestone loop exactly as proven: items 1–4 and 7–8 done; item 5 (three scans across seven days) recorded as not done live — two same-session live scans, with the mechanism proven offline by the integration suite's injected-clock three-scan run; item 6 proven offline and partial live. Known limitations stated: seed asset vocabulary, no scheduler, grouping as recorded interpretation.

## Current state: alpha security blockers

The `fix/alpha-security-blockers` branch (PR #14) closed four confirmed
blockers without touching snapshot schema `0.1`, CLI commands, scoring, or
source policy:

- `writeSnapshot` and `readSnapshot` recompute every document's SHA-256
  identity from `sourceId|kind|url|title|text` and reject a forged or stale
  `contentHash`/`docId` on both paths (`corrupted-snapshot`).
- `runDirOf` validates the runId against the locked `RUN_ID_PATTERN` before
  joining, so `candidates --run` with a traversal-shaped id exits 1 without
  touching a path outside the store.
- `payloads.ts` validates successful captures per fixed connector family
  before persistence and normalization. A malformed HTTP-200 capture becomes
  a recorded failure that keeps id/url/status/timestamp, drops the payload,
  and is marked `invalid payload`; other connectors keep running and the scan
  degrades (exit 2) while usable documents remain. Unknown connector ids pass
  through untouched.
- `HttpConnectorOptions` gains `maxResponseBytes` (`DEFAULT_MAX_RESPONSE_BYTES`
  = 16 MiB): invalid limits reject before the request, `Content-Length` is
  pre-checked when present, the decompressed stream is always enforced, and
  JSON parses only after the bounded body is collected. Oversized or invalid
  JSON responses are recorded failures preserving the HTTP status.

## Current state: asset resolution and the run briefing

The `feat/asset-resolution` branch fixed the reason scans produced no usable
output, and added the surface a user actually reads:

- Mention resolution (rules version `2`, `packages/lib/src/assets.ts`) derives
  its vocabulary from the snapshot: `market` documents supply the tradeable
  universe, `tvl` documents supply protocol-name aliases. Canonical key is the
  uppercase ticker; matching is word-boundary and longest-alias-wins.
- Before this, resolution ran against nine hardcoded strings with substring
  matching and compared lowercase names to uppercase tickers, so
  `marketConfirmation` and `investability` could not be non-zero. Against the
  unchanged `2026-08-28T13-48-29` snapshot: 0 of 28 narratives scored before,
  18 of 28 after; `n0003` (Ethena/ENA, ENA +12.08% that day) went `0.000` to
  `0.667`.
- `mover` documents were being deduplicated away by the `market` row for the
  same asset (dedup is first-write-wins on `(sourceId, url)`, and both carried
  the same url), which is why the alpha-signals sheet rendered empty on every
  run. Movers now carry a distinct url.
- `resonance brief` renders the run output: off-radar movers first, then
  confirmed narratives ranked, then the run's limits. `docs/PROTOCOL.md` step 6
  and `AGENTS.md` require the agent to present it after every scan.
- `resonance candidates` shows the top 10 of the ranking by default;
  `--all` and `--components` restore the full detail.
- The local store `.resonance/` is gitignored, matching `spike/data/`.

## What does not exist yet

- The complete branch sequence is merged and released. The versioned extension of the known-asset vocabulary is done (mention rules `2`, see "asset resolution and the run briefing" above); what remains owed from the milestone is the multi-day live soak (item 5).
- No database, scheduler, embeddings, MCP, trading, or browser UI — and none are planned for the private alpha.

## Milestone progress

`v0.1.0-alpha.1` — **released**: all fourteen branches of the sequence are merged and tagged `v0.1.0-alpha.1` on `main`. The milestone loop is proven except item 5's multi-day live soak, recorded honestly in [RELEASE-NOTES.md](RELEASE-NOTES.md). `v0.1.0-alpha.2` — **released**: the two branches merged after the alpha.1 tag (`fix/alpha-security-blockers`, PR #14; `feat/asset-resolution`, PR #15) are versioned and tagged, with their results and current known limitations recorded in [RELEASE-NOTES.md](RELEASE-NOTES.md). No schema, CLI-command, or scoring-formula changes. See [DESIGN.md](DESIGN.md) for the branch sequence and [HANDOFF.md](HANDOFF.md) for the current integration state.
