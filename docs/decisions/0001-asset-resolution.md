# 0001 — Asset resolution from the snapshot, not a literal

Status: accepted
Date: 2026-08-28
Supersedes: none

## Context

The `2026-08-28T13-48-29` run produced 28 evidence-backed narratives and not
one usable score. Measured across its evidence packs: eleven narratives scored
`0.000 at coverage 0.20`, seventeen scored `none`. No narrative in the run
could have scored above zero, whatever the news that day.

Three defects in mention resolution combined to guarantee it.

1. **The vocabulary was nine hardcoded strings** — `bitcoin, btc, ethereum,
   eth, solana, sol, clarity, genesis, clankster` — three real assets plus
   three spike leftovers. The same scan captured 932 tradeable symbols. ENA,
   HEMI, TRUMP, EDEN, CHIP, and MANTRA could never resolve.

2. **Matching was raw substring.** `"Ethena"` contains `eth`, so the narrative
   *about ENA buybacks* resolved to `eth`.

3. **Consumers compared different namespaces.** `assetsMentioned` held
   lowercase names; `movers[].asset` and `marketAssets` hold uppercase
   exchange tickers. `mentioned.has(m.asset)` could not match.

The result: `marketConfirmation` and `investability` — the only two ungated
components, and therefore the only two that can score on a first run — were
structurally incapable of being non-zero. ENA moved **+12.08%** that day and
its narrative reported `marketConfirmation=0.00`.

## Decision

Mention resolution moves to `packages/lib/src/assets.ts` and the rules version
becomes `2`.

- **The vocabulary is derived from the snapshot, not declared.** Exchange
  `market` documents supply the tradeable universe; `tvl` documents supply
  protocol-name aliases (DefiLlama carries `Ethena USDe → ENA`). Only tickers
  with an exchange quote are registered, so every resolved asset is one a
  component can confirm.
- **The canonical key is the uppercase ticker.** Every consumer compares one
  namespace.
- **Matching is word-boundary and longest-alias-wins**, by n-gram lookup over
  tokenized text. Word boundaries alone fix the `Ethena → eth` class of bug.
- **An explicit deny list** covers venue names (`binance`, `coinbase`) and
  tickers that are ordinary English words. Entries were selected by measuring
  which aliases mis-resolved real documents in the 2026-08-28 corpus, not by
  guesswork: `Bank of England → BANK`, `rose 5% → ROSE`, `240 people → PEOPLE`,
  `groups form → FORM`.

Separately, normalization gives `mover` documents a distinct url. Deduplication
is first-write-wins on `(sourceId, url)`, and the `market` row for the same
asset is written first from the same tape, so **every screened mover was being
silently dropped** — which is why `reference-alpha-signals.md` rendered
`_No documents of these kinds in this snapshot._` on every run.

## Consequences

Measured against the unchanged `2026-08-28T13-48-29` snapshot and grouping:

| | before | after |
| --- | --- | --- |
| narratives with a score | 0 of 28 | 18 of 28 |
| distinct score values | 1 (`0.000`) | 3 |
| `n0003` (Ethena/ENA) | `0.000` | **`0.667`** |
| `n0003` assets resolved | `["eth"]` | `["ENA"]` |
| mover documents in snapshot | 0 | screened set retained |

The ten unscored narratives mention no tradeable asset (Visa/Dunamu,
BitGo/NYDIG, the Zondacrypto probe). Reporting them as unscored is correct
under "never a fabricated zero".

Bumping the rules version changes every historical observation. With one run
in the store, observations are recomputed rather than migrated; a later bump
will need a migration path.

Known ambiguity accepted for now: `optimism` resolves to `OP`, and the word
appears in market commentary. It is kept because in a crypto corpus the chain
reading dominates. If it produces false positives in a later run, it joins the
deny list and this record gains a successor.
