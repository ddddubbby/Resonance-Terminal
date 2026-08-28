# Release Notes

Newest first. Each section records what that release actually proved, not what it hoped to.

## v0.1.0-alpha.2 (private alpha)

A correctness and safety release on top of `v0.1.0-alpha.1`. Two branches merged after the alpha.1 tag: the four security blockers, and the fix for why scans produced no usable output. No schema, CLI-command, or scoring-formula changes.

### Scans now produce a usable score, and a briefing

A live scan on 2026-08-28 produced 28 evidence-backed, cross-source narratives and **not one usable score** — 11 at `0.000`, 17 at `none`. That was structural, not a data problem. Mention resolution ran against nine hardcoded strings while the same run captured 932 tradeable symbols; matching was raw substring, so `"Ethena"` matched `eth`; and `marketConfirmation`/`investability` compared lowercase resolved names against uppercase exchange tickers. Those two are the only ungated components — the only two that *can* score on a first run — so they could not be non-zero by construction.

- **Mention resolution derives its vocabulary from the snapshot** (rules version `2`, `packages/lib/src/assets.ts`): `market` documents supply the tradeable universe, `tvl` documents supply protocol-name aliases (DefiLlama's `Ethena USDe` row yields `ethena → ENA`). The canonical key is the uppercase ticker everywhere. Matching is word-boundary and longest-alias-wins; the deny list (venue names, English-word tickers) was built by measuring which aliases mis-resolved real documents, not guessed.
- **Mover documents survive deduplication.** They were being dropped by the `market` row for the same asset — both carried the same URL, and deduplication is first-write-wins on `(sourceId, url)`. This is why `evidence/reference-alpha-signals.md` rendered empty on every run.
- **`resonance brief` is the run's output** ([PROTOCOL.md](PROTOCOL.md) step 6): off-radar movers (screened movers no narrative mentions) ranked by magnitude, then confirmed narratives (resolved assets among the movers) ranked by score, then a plain statement of what the run could not measure. `AGENTS.md` requires the agent to present it after every scan — a scan that writes artifacts and reports only that files exist has not completed.
- **`resonance candidates` ranks and truncates** to the top 10 by default (`--all`, `--components` restore full detail). It previously printed all 28 narratives with all seven component lines each.

Measured against the unchanged `2026-08-28T13-48-29` snapshot and grouping — the real run, not a fixture:

| | alpha.1 | alpha.2 |
| --- | --- | --- |
| narratives with a score | 0 of 28 | 18 of 28 |
| `n0003` (Ethena/ENA, ENA +12.08% that day) | `0.000`, resolved `["eth"]` | `0.667`, resolved `["ENA"]` |
| `candidates` output | 196 unranked lines, all zero or none | 13 ranked lines |
| off-radar movers surfaced | none (sheet always empty) | 8 (HEMI +36.67%, EDEN +20.87%, CHIP +16.00%, …) |

### Security fixes

Four confirmed blockers, closed without touching snapshot schema `0.1`, CLI commands, scoring, or source policy:

- **Snapshot identity is recomputed on write and read** from `sourceId|kind|url|title|text`; a forged or stale `contentHash`/`docId` is rejected on both paths (`corrupted-snapshot`).
- **Run-id path traversal is blocked.** `runDirOf` validates against the locked `RUN_ID_PATTERN` before joining, so `candidates --run` with a traversal-shaped id exits 1 without touching a path outside the store.
- **Malformed HTTP-200 payloads never reach persistence.** `payloads.ts` validates successful captures per fixed connector family; a malformed capture becomes a recorded failure keeping id/url/status/timestamp with the payload dropped, other connectors keep running, and the scan degrades (exit 2) while usable documents remain. Unknown connector ids pass through untouched.
- **Response bodies are bounded.** `HttpConnectorOptions` gains `maxResponseBytes` (`DEFAULT_MAX_RESPONSE_BYTES` = 16 MiB), enforced on the decompressed stream with `Content-Length` pre-checked when present; JSON parses only after the bounded body is collected, and oversized or invalid responses are recorded failures preserving the HTTP status.

### Known limitations

- **`investability` is currently uninformative.** Every scored narrative gets exactly `1.0`, because the asset index only registers tickers with an exchange quote — a resolved asset is tradeable by construction. It carries 10% weight for no discriminating information. A liquidity-weighted redefinition is the natural fix and is a score-rule change requiring its own approved PR.
- **`momentum` (30% weight) is entirely cold-start-gated**, so a first scan on a fresh store still cannot produce a full score. Splitting it into a backfillable price component and a gated attention component is scoped but not started.
- **Narrative granularity is event-level**, per the "Narrative granularity" decision in [DESIGN.md](DESIGN.md). Themes spanning weeks and many events need the event-to-theme layer, which is not built.
- **The multi-day live soak is still owed** from the alpha.1 milestone loop (item 5): at least three scans across seven days against a committed store. Unchanged by this release.
- **No scheduler**; scans are manual. **Grouping remains agent-side interpretation**, recorded as such.
- The alpha.1 note that the seed asset vocabulary makes `marketConfirmation`/`investability` score zero **no longer applies** and is superseded above.

### Verification at the release cut

- `pnpm verify` green: Biome clean, both packages build, typecheck clean, **197 tests across 19 files**, packed CLI smoke from an isolated temp directory.
- Re-scored the real `2026-08-28T13-48-29` snapshot and grouping to produce the table above; `resonance brief` and `resonance candidates` exercised end-to-end against that store.

## v0.1.0-alpha.1 (private alpha)

Resonance Terminal is a crypto-only narrative intelligence terminal. This is the private alpha: a usable local tool that runs the complete loop — scan public sources, group cross-source events into narratives, track them across runs, score them honestly, and hand the workspace between coding agents. It is built publicly on GitHub; this release is cut from `main`, not npm-published.

### What this release can do

- Install with one command (`scripts/install.sh`) through a coding agent or a shell. Node 22 and pnpm 10 are checked, dependencies install with `--frozen-lockfile`, and `pnpm verify` gates the install. **No API keys anywhere.**
- Scan five fixed public-data connector families in one run: Binance and Coinbase market tapes, DefiLlama TVL, seven RSS/Atom feeds, and GitHub releases — 24 endpoints total. Raw captures persist beside every snapshot.
- Write an immutable, git-trackable snapshot per run (schema `0.1`, deterministic serialization, content-hash deduplication, recorded source failures, exit code `2` on degradation).
- Support the full research protocol ([PROTOCOL.md](PROTOCOL.md)): agent-side event grouping with written rationale, deterministic narrative identity across runs (`n0001`…), one observation per narrative per scan, evidence packs with docId-traceable excerpts and an untrusted-data warning, and honest partial scoring (six weighted components, a per-narrative cold-start gate, explicit coverage).
- Operate through the packed CLI: `scan`, `candidates`, `status`, `promote`, `handoff`, with `--store` and `--json`.
- Hand the workspace between coding agents with `resonance handoff` — a deterministic rendering of store state; the receiving agent reads AGENTS.md, then the handoff text, then continues.

### Milestone loop: honest results

The milestone ([DESIGN.md](DESIGN.md)) defines an eight-item loop. Status of each item, as proven, not as hoped:

1. **Install locally through a coding agent without API keys** — done. `scripts/install.sh` was run live to completion with the full verify gate (exit 0).
2. **Run five fixed public-data connectors** — done. Live smoke: 24/24 connectors ok, twice, with zero failures across both scans (3,684 Binance tickers, 833 Coinbase products, 129 Robinhood-Chain protocols on DefiLlama).
3. **Create an immutable snapshot** — done. Two live snapshots written under the locked schema, validated on read.
4. **Produce ten evidence-backed narrative candidates from real data** — done. The live smoke grouped 242 textual documents into 20 cross-source narratives (`n0001`–`n0020`), each with written rationale and a docId-traceable evidence pack; `candidates` reports them with honest component availability.
5. **Repeat at least three scans across seven days** — *not done live.* Two live scans ran in one session. The mechanism is proven offline instead: the integration suite runs three scans across fifteen days with an injected clock and asserts the cold-start gate opens honestly at the right moment. A multi-day live soak is carried into post-release operation, not claimed here.
6. **Show changes and attention-derived metrics from accumulated observations** — *proven offline, partial live.* Offline: the gate opens at the third observation and all six components score. Live: observations accumulate across the two scans, but both sit inside the cold-start window, so attention components honestly report `cold-start` unavailability — which is the metric system doing its job, not a failure.
7. **Publish full or explicitly labeled partial scores** — done. Every score ships with per-component availability, reasons, and coverage; a partial score never masquerades as a full one.
8. **Hand the workspace between agents without losing direction or state** — done. The branch sequence itself was built across agent sessions via HANDOFF.md; `resonance handoff` makes the handoff a deterministic artifact.

### Known limitations

- **Seed asset vocabulary.** Mention resolution (`KNOWN_ASSETS_V1`) is deliberately tiny; `marketConfirmation` and `investability` therefore score zero on most real narratives today (movers are altcoin pairs; market assets carry pair bases like `BTC` while mentions resolve to names like `bitcoin`). Extending the vocabulary is a versioned, deliberate change.
- **No scheduler.** Scans are manual; the milestone soak depends on a human or agent running `resonance scan` repeatedly.
- **Grouping is agent-side interpretation.** It is recorded as interpretation (model and rules stamps, written rationale) — reproducible by record, not bit-stable.

### Verification at the release cut

- `pnpm verify` green: Biome clean, both packages build, typecheck clean, **149 tests across 16 files**, packed CLI smoke from an isolated temp directory.
- Live smoke numbers: 2 scans, 24/24 connectors ok each, 242 textual documents, 47 pre-group hints, 20 narratives, 20 observations, 20 evidence packs + 3 reference sheets, full CLI chain including promotion and handoff.
