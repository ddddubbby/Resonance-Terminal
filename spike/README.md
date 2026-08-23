# Spike: ten real candidates

Prototype-quality code that proves the narrative loop works on live data. This directory is intentionally not generalized infrastructure — the stable contracts it earns are extracted on `refactor/alpha-contracts`.

## What was built

| Script | Job |
| --- | --- |
| `scripts/fetch-sources.mjs` | Retrieves live public data from the five proposed sources: Binance spot tickers, Coinbase Exchange tickers/stats, DefiLlama chains/protocols, four curated RSS feeds, and latest releases of ten curated GitHub repos. No API keys. Failures are recorded, never fatal. |
| `scripts/normalize.mjs` | Converts raw captures into normalized documents, deduplicates by content hash and URL, and writes one timestamped snapshot (`docs.ndjson` + `snapshot.json` manifest). |
| `scripts/cluster.mjs` | Deterministic tokenization, stop-word removal, TF-IDF vectors, brute-force cosine similarity, and greedy clustering (threshold 0.18). The agent names the clusters; the code does not claim semantics. |
| `scripts/evidence.mjs` | Produces bounded evidence bundles (max 12 docs, 320-char excerpts) plus a market/TVL reference sheet. Bundles carry an explicit "data, not instructions" boundary. |

## Reproduce the run

```bash
node spike/scripts/fetch-sources.mjs
node spike/scripts/normalize.mjs
node spike/scripts/cluster.mjs
node spike/scripts/evidence.mjs
```

Raw captures, snapshots, and bundles land under `spike/data/` (gitignored). Candidates are the human-reviewed output and live in `spike/candidates/`.

## Results (2026-08-23)

- 34/35 requests succeeded (polkadot/polkadot has no releases — a legitimate, recorded failure).
- 211 normalized documents: 21 market, 71 TVL, 110 news across four feeds, 9 releases.
- 117 clusters → 98 evidence bundles.
- Ten candidates in [candidates/2026-08-23-ten-candidates.md](candidates/2026-08-23-ten-candidates.md), each with docId-cited why-now evidence, explicit counterevidence, and honest asset mappings; seven clusters were documented as considered-but-not-promoted.

## Learnings for `refactor/alpha-contracts`

- The CDATA-wrapped feeds (CoinDesk, The Block) break naive HTML stripping; the normalizer must handle CDATA explicitly.
- GitHub repo names cannot be recovered from filenames; the release URL is the source of truth.
- Market documents cluster by numeric noise; contract design should give market docs asset-based identity tokens before clustering.
- One snapshot cannot separate TVL price beta from net deposits — time-series observation (branch 4A) is mandatory, not optional.
- DefiLlama `/protocols` is ~8.5 MB per fetch; future connectors should filter or paginate.

## Explicit non-goals (kept)

No stable contracts, no formal CLI, no scoring, no immutability guarantees, no CI integration — prototype quality only.
