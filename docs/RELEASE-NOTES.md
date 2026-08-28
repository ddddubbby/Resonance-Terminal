# Release Notes — v0.1.0-alpha.1 (private alpha)

Resonance Terminal is a crypto-only narrative intelligence terminal. This is the private alpha: a usable local tool that runs the complete loop — scan public sources, group cross-source events into narratives, track them across runs, score them honestly, and hand the workspace between coding agents. It is built publicly on GitHub; this release is cut from `main`, not npm-published.

## What this release can do

- Install with one command (`scripts/install.sh`) through a coding agent or a shell. Node 22 and pnpm 10 are checked, dependencies install with `--frozen-lockfile`, and `pnpm verify` gates the install. **No API keys anywhere.**
- Scan five fixed public-data connector families in one run: Binance and Coinbase market tapes, DefiLlama TVL, seven RSS/Atom feeds, and GitHub releases — 24 endpoints total. Raw captures persist beside every snapshot.
- Write an immutable, git-trackable snapshot per run (schema `0.1`, deterministic serialization, content-hash deduplication, recorded source failures, exit code `2` on degradation).
- Support the full research protocol ([PROTOCOL.md](PROTOCOL.md)): agent-side event grouping with written rationale, deterministic narrative identity across runs (`n0001`…), one observation per narrative per scan, evidence packs with docId-traceable excerpts and an untrusted-data warning, and honest partial scoring (six weighted components, a per-narrative cold-start gate, explicit coverage).
- Operate through the packed CLI: `scan`, `candidates`, `status`, `promote`, `handoff`, with `--store` and `--json`.
- Hand the workspace between coding agents with `resonance handoff` — a deterministic rendering of store state; the receiving agent reads AGENTS.md, then the handoff text, then continues.

## Milestone loop: honest results

The milestone ([DESIGN.md](DESIGN.md)) defines an eight-item loop. Status of each item, as proven, not as hoped:

1. **Install locally through a coding agent without API keys** — done. `scripts/install.sh` was run live to completion with the full verify gate (exit 0).
2. **Run five fixed public-data connectors** — done. Live smoke: 24/24 connectors ok, twice, with zero failures across both scans (3,684 Binance tickers, 833 Coinbase products, 129 Robinhood-Chain protocols on DefiLlama).
3. **Create an immutable snapshot** — done. Two live snapshots written under the locked schema, validated on read.
4. **Produce ten evidence-backed narrative candidates from real data** — done. The live smoke grouped 242 textual documents into 20 cross-source narratives (`n0001`–`n0020`), each with written rationale and a docId-traceable evidence pack; `candidates` reports them with honest component availability.
5. **Repeat at least three scans across seven days** — *not done live.* Two live scans ran in one session. The mechanism is proven offline instead: the integration suite runs three scans across fifteen days with an injected clock and asserts the cold-start gate opens honestly at the right moment. A multi-day live soak is carried into post-release operation, not claimed here.
6. **Show changes and attention-derived metrics from accumulated observations** — *proven offline, partial live.* Offline: the gate opens at the third observation and all six components score. Live: observations accumulate across the two scans, but both sit inside the cold-start window, so attention components honestly report `cold-start` unavailability — which is the metric system doing its job, not a failure.
7. **Publish full or explicitly labeled partial scores** — done. Every score ships with per-component availability, reasons, and coverage; a partial score never masquerades as a full one.
8. **Hand the workspace between agents without losing direction or state** — done. The branch sequence itself was built across agent sessions via HANDOFF.md; `resonance handoff` makes the handoff a deterministic artifact.

## Known limitations

- **Seed asset vocabulary.** Mention resolution (`KNOWN_ASSETS_V1`) is deliberately tiny; `marketConfirmation` and `investability` therefore score zero on most real narratives today (movers are altcoin pairs; market assets carry pair bases like `BTC` while mentions resolve to names like `bitcoin`). Extending the vocabulary is a versioned, deliberate change.
- **No scheduler.** Scans are manual; the milestone soak depends on a human or agent running `resonance scan` repeatedly.
- **Grouping is agent-side interpretation.** It is recorded as interpretation (model and rules stamps, written rationale) — reproducible by record, not bit-stable.

## Verification at the release cut

- `pnpm verify` green: Biome clean, both packages build, typecheck clean, **149 tests across 16 files**, packed CLI smoke from an isolated temp directory.
- Live smoke numbers: 2 scans, 24/24 connectors ok each, 242 textual documents, 47 pre-group hints, 20 narratives, 20 observations, 20 evidence packs + 3 reference sheets, full CLI chain including promotion and handoff.
