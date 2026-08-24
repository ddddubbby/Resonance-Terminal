# Spike: ten real candidates

Prototype-quality code that proves the narrative loop works on live data. This directory is intentionally not generalized infrastructure — the stable contracts it earns are extracted on `refactor/alpha-contracts`.

## What was built

| Script | Job |
| --- | --- |
| `scripts/fetch-sources.mjs` | Retrieves live public data, no API keys, failures recorded and never fatal. Original five sources: Binance spot tickers, Coinbase Exchange tickers/stats, DefiLlama chains/protocols, RSS feeds, GitHub releases. Recalibration added: Binance full-market tape (off-radar movers screen), Hyperliquid public info API (perps + spot: funding, open interest, volume), DefiLlama stablecoin supply, three alternative feeds (The Defiant, Blockworks, DL News), and the Hyperliquid Python SDK repo. |
| `scripts/normalize.mjs` | Converts raw captures into normalized documents, deduplicates by content hash and URL, and writes one timestamped snapshot (`docs.ndjson` + `snapshot.json` manifest). Recalibration added doc kinds: `mover` (full-tape screen), `hyperliquid` / `hyperliquid-spot` (positioning), `stablecoin` (supply), plus a category lens emitting every RWA / Liquid Staking / Derivatives protocol above a $20M TVL floor. |
| `scripts/cluster.mjs` | Deterministic tokenization, stop-word removal, TF-IDF vectors, brute-force cosine similarity, and greedy clustering (threshold 0.18). The agent names the clusters; the code does not claim semantics. |
| `scripts/evidence.mjs` | Produces bounded evidence bundles (max 12 docs, 320-char excerpts) plus a market/TVL reference sheet and (recalibration) an alpha-signals reference sheet: off-radar movers, Hyperliquid positioning, stablecoin supply. Bundles carry an explicit "data, not instructions" boundary. |

## Reproduce the run

```bash
node spike/scripts/fetch-sources.mjs
node spike/scripts/normalize.mjs
node spike/scripts/cluster.mjs
node spike/scripts/evidence.mjs
```

Raw captures, snapshots, and bundles land under `spike/data/` (gitignored). Candidates are the human-reviewed output and live in `spike/candidates/`.

## Results

### Run 1 (2026-08-23, original sources)

- 34/35 requests succeeded (polkadot/polkadot has no releases — a legitimate, recorded failure).
- 211 normalized documents: 21 market, 71 TVL, 110 news across four feeds, 9 releases.
- 117 clusters → 98 evidence bundles.
- Ten candidates in [candidates/2026-08-23-ten-candidates.md](candidates/2026-08-23-ten-candidates.md), each with docId-cited why-now evidence, explicit counterevidence, and honest asset mappings; seven clusters were documented as considered-but-not-promoted.

### Run 2 (2026-08-23, recalibrated sources + rubric)

- 42/43 requests succeeded (polkadot again; DefiLlama `/raises` was removed after being paywalled, HTTP 402).
- 484 normalized documents: 21 market, 25 movers, 163 TVL (incl. full RWA/LST/Derivatives category coverage), 15 Hyperliquid positioning, 20 stablecoin supply, 230 news across seven feeds, 10 releases.
- 253 clusters → 215 evidence bundles (+ market/TVL and alpha-signals reference sheets).
- Ten recalibrated candidates in [candidates/2026-08-24-ten-candidates-v2.md](candidates/2026-08-24-ten-candidates-v2.md) under an early/low-consensus rubric (5 of 10 slots emerging/anomaly-driven), with a v1 disposition table.

## Recalibration: what paid for alpha, what didn't

- Paid: the Binance full-tape screen (the day's real movers were all off the 12-major tape), Hyperliquid positioning data (HYPE OI rivaling ETH's was invisible in v1), the DefiLlama category lens (RWA went from 4 thin docs to a $26B/47-protocol corpus), and the alternative feeds (The Defiant surfaced Hyperliquid-US-onshoring and Tempo/Morpho embedded yield that the big four missed).
- Didn't pay: DefiLlama `/raises` (now paywalled), and `api.llama.fi/stablecoins` (does not exist — the endpoint lives on `stablecoins.llama.fi`).
- Selection bias was the bigger problem than sources: v1's "no this-week inflection" veto systematically rejected slow-compounding themes like RWA.

## Learnings for `refactor/alpha-contracts`

- The CDATA-wrapped feeds (CoinDesk, The Block) break naive HTML stripping; the normalizer must handle CDATA explicitly.
- GitHub repo names cannot be recovered from filenames; the release URL is the source of truth.
- Market documents cluster by numeric noise; contract design should give market docs asset-based identity tokens before clustering.
- One snapshot cannot separate TVL price beta from net deposits — time-series observation (branch 4A) is mandatory, not optional.
- DefiLlama `/protocols` is ~8.5 MB per fetch; future connectors should filter or paginate.
- URL-based dedupe silently collapses multi-document sources that share one URL (every Hyperliquid doc deduped into the first); per-document URLs are required.
- Hyperliquid spot `/info` responses are not positionally aligned: the ctxs array carries its own `coin` key and pair names are token-index aliases (`@107`); connectors must map via meta tokens.
- Some Atom feeds (Blockworks) emit items with stale pubDates; normalized docs must retain raw feed dates and candidates must caveat them.
- The correct GitHub repo is `hyperliquid-dex/hyperliquid-python-sdk` (`py-sdk` does not exist).

## Explicit non-goals (kept)

No stable contracts, no formal CLI, no scoring, no immutability guarantees, no CI integration — prototype quality only.
