/**
 * Asset resolution: the join between what documents talk about and what the
 * market is doing.
 *
 * Mention resolution used to run against nine hardcoded strings with raw
 * substring matching, which produced two silent failures: assets outside the
 * literal could never resolve (ENA, HEMI, TRUMP), and `"Ethena"` resolved to
 * `eth` because the string contains it. Every downstream comparison then comp-
 * ared lowercase names against uppercase exchange tickers, so the market-
 * confirmation and investability components could not be non-zero by
 * construction.
 *
 * This module fixes all three. The vocabulary is derived from the snapshot
 * itself rather than declared: exchange market documents supply the tradeable
 * universe, and TVL documents supply protocol-name aliases for those tickers.
 * The canonical key is the uppercase exchange ticker, so every consumer
 * compares one namespace.
 *
 * Matching is word-boundary and longest-alias-wins, implemented by n-gram
 * lookup over tokenized text rather than per-alias regexes: with ~1,000
 * aliases the regex approach is quadratic on every document.
 *
 * The rules are versioned ({@link MENTION_RULES_VERSION}). Changing them
 * changes every historical observation, so a bump is a decision-record
 * change, recorded in docs/decisions/.
 */

import type { SourceDocument } from "./index.js";

/**
 * Mention resolution rules, versioned. Bumped to `2` when resolution moved
 * from the nine-string seed vocabulary to snapshot-derived aliases with
 * word-boundary matching (docs/decisions/0001-asset-resolution.md).
 */
export const MENTION_RULES_VERSION = "2";

/**
 * Document kinds whose prose is searched for asset mentions. The same set is
 * the grouping corpus and the unsaturation denominator, so it lives here as
 * the single definition.
 */
export const TEXTUAL_KINDS: ReadonlySet<string> = new Set(["news", "release"]);

/** Longest alias, in words, that {@link resolveMention} will match. */
const MAX_ALIAS_WORDS = 3;

/** Shortest ticker that may act as its own alias; below this, noise wins. */
const MIN_TICKER_LENGTH = 3;

/**
 * Aliases for assets whose common name never appears as a protocol name in
 * the TVL feed. Small, explicit, and reviewable by design — the derived
 * aliases carry everything else.
 */
const MAJOR_ALIASES: Readonly<Record<string, string>> = {
  bitcoin: "BTC",
  ether: "ETH",
  ethereum: "ETH",
  solana: "SOL",
  cardano: "ADA",
  dogecoin: "DOGE",
  polkadot: "DOT",
  avalanche: "AVAX",
  chainlink: "LINK",
  litecoin: "LTC",
  polygon: "MATIC",
  ripple: "XRP",
  tron: "TRX",
  monero: "XMR",
  stellar: "XLM",
  cosmos: "ATOM",
  aptos: "APT",
  arbitrum: "ARB",
  optimism: "OP",
  uniswap: "UNI",
  hyperliquid: "HYPE",
};

/**
 * Aliases that are too ambiguous to resolve: common English words that
 * happen to be tickers, and the names of venues and companies that appear in
 * crypto prose constantly without the article being about their token.
 * Without this, "Binance CEX" (ticker BNB) would tag most of the corpus.
 */
const DENIED_ALIASES: ReadonlySet<string> = new Set([
  // Venues and issuers: named in prose far more often than as an asset.
  "binance",
  "coinbase",
  "kraken",
  "bitfinex",
  "bybit",
  "okx",
  "upbit",
  "gemini",
  "tether",
  "circle",
  "ripple",
  "consensys",
  // Tickers that are ordinary English words. The list below is not guesswork:
  // each entry was observed resolving a real document to the wrong asset in
  // the 2026-08-28 corpus, or is the same class of word as one that did
  // ("Bank of England" -> BANK, "rose 5%" -> ROSE, "240 people" -> PEOPLE).
  "all",
  "rose",
  "people",
  "multi",
  "meta",
  "lighter",
  "home",
  "form",
  "front",
  "bull",
  "bond",
  "bill",
  "bear",
  "bank",
  "and",
  "any",
  "are",
  "act",
  "ai",
  "arc",
  "ask",
  "ban",
  "bar",
  "bid",
  "big",
  "bit",
  "boss",
  "cap",
  "cash",
  "cat",
  "chat",
  "chip",
  "cro",
  "cut",
  "data",
  "deal",
  "dip",
  "dog",
  "edge",
  "end",
  "era",
  "fact",
  "fair",
  "far",
  "fee",
  "first",
  "flow",
  "for",
  "fun",
  "gas",
  "get",
  "gods",
  "gold",
  "good",
  "hall",
  "hat",
  "high",
  "hit",
  "hot",
  "how",
  "id",
  "idea",
  "index",
  "job",
  "key",
  "lab",
  "land",
  "law",
  "life",
  "like",
  "line",
  "live",
  "look",
  "lot",
  "love",
  "low",
  "man",
  "map",
  "mass",
  "me",
  "meme",
  "mind",
  "mint",
  "move",
  "must",
  "my",
  "near",
  "net",
  "new",
  "news",
  "next",
  "not",
  "now",
  "one",
  "open",
  "our",
  "out",
  "own",
  "pack",
  "page",
  "paid",
  "pair",
  "part",
  "past",
  "pay",
  "peak",
  "pick",
  "plan",
  "play",
  "point",
  "pool",
  "port",
  "post",
  "pro",
  "pump",
  "put",
  "rare",
  "read",
  "real",
  "red",
  "rise",
  "risk",
  "run",
  "safe",
  "sale",
  "say",
  "see",
  "self",
  "sell",
  "set",
  "shot",
  "side",
  "sign",
  "site",
  "size",
  "slow",
  "some",
  "soon",
  "spot",
  "star",
  "stay",
  "step",
  "stop",
  "sun",
  "sure",
  "swap",
  "take",
  "talk",
  "team",
  "tech",
  "tell",
  "test",
  "the",
  "time",
  "tip",
  "top",
  "trade",
  "true",
  "trust",
  "try",
  "turn",
  "two",
  "up",
  "use",
  "very",
  "view",
  "vote",
  "wave",
  "way",
  "web",
  "week",
  "well",
  "what",
  "when",
  "who",
  "why",
  "will",
  "win",
  "work",
  "year",
  "yes",
  "you",
]);

/**
 * The asset vocabulary of one snapshot: which tickers are tradeable, and
 * which lowercase aliases resolve to them.
 */
export interface AssetIndex {
  /** Lowercase alias (one to {@link MAX_ALIAS_WORDS} words) to ticker. */
  readonly aliases: ReadonlyMap<string, string>;
  /** Canonical uppercase tickers quoted by an exchange this scan. */
  readonly tradeable: ReadonlySet<string>;
}

/** Lowercase word tokens of a string; the unit of alias matching. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * The protocol name inside a TVL document title, which normalization renders
 * as `TVL <name> $<amount> (<category>)`. Returns `undefined` when the title
 * does not carry that shape.
 */
function tvlProtocolName(title: string): string | undefined {
  const match = /^TVL\s+(.+?)\s+\$/.exec(title);
  return match?.[1];
}

/** Register an alias unless it is denied, empty, or already claimed. */
function addAlias(aliases: Map<string, string>, alias: string, ticker: string): void {
  const key = alias.trim().toLowerCase();
  if (key === "" || DENIED_ALIASES.has(key)) {
    return;
  }
  const words = key.split(" ");
  if (words.length > MAX_ALIAS_WORDS) {
    return;
  }
  // A single-word alias must clear the length floor however it was derived;
  // without this a protocol named "Re" registers a two-letter alias that
  // matches most English prose.
  if (words.length === 1 && key.length < MIN_TICKER_LENGTH) {
    return;
  }
  // First registration wins, so the derivation order below is the priority
  // order: tickers, then major names, then protocol names.
  if (!aliases.has(key)) {
    aliases.set(key, ticker);
  }
}

/**
 * Build the asset vocabulary of a snapshot from its own documents.
 *
 * Sources, in priority order:
 *
 * 1. `market` documents — the tradeable universe. Each ticker is its own
 *    alias when it is long enough to be distinctive.
 * 2. {@link MAJOR_ALIASES} — common names for majors, kept for tickers that
 *    are actually quoted this scan.
 * 3. `tvl` documents — protocol names from DefiLlama, plus the first word of
 *    a multi-word name (`Ethena USDe` also registers `ethena`).
 *
 * Only tickers with an exchange quote are registered: an alias that cannot be
 * confirmed against market data is not useful to any component that consumes
 * this index.
 */
export function buildAssetIndex(documents: readonly SourceDocument[]): AssetIndex {
  const tradeable = new Set<string>();
  for (const doc of documents) {
    if (doc.kind === "market" && doc.asset !== undefined) {
      tradeable.add(doc.asset.toUpperCase());
    }
  }

  const aliases = new Map<string, string>();
  for (const ticker of [...tradeable].sort()) {
    if (ticker.length >= MIN_TICKER_LENGTH) {
      addAlias(aliases, ticker, ticker);
    }
  }
  for (const [name, ticker] of Object.entries(MAJOR_ALIASES)) {
    if (tradeable.has(ticker)) {
      addAlias(aliases, name, ticker);
    }
  }
  for (const doc of documents) {
    if (doc.kind !== "tvl" || doc.asset === undefined) {
      continue;
    }
    const ticker = doc.asset.toUpperCase();
    if (!tradeable.has(ticker)) {
      continue;
    }
    const name = tvlProtocolName(doc.title);
    if (name === undefined) {
      continue;
    }
    const words = tokenize(name);
    if (words.length === 0) {
      continue;
    }
    addAlias(aliases, words.join(" "), ticker);
    // `Ethena USDe` should also answer to `Ethena`; a bare first word is only
    // distinctive enough when it is not a short fragment.
    const first = words[0];
    if (words.length > 1 && first !== undefined && first.length >= MIN_TICKER_LENGTH) {
      addAlias(aliases, first, ticker);
    }
  }

  return { aliases, tradeable };
}

/**
 * Resolve the asset a textual document is about, as a canonical ticker.
 *
 * Matching is word-boundary by construction (the text is tokenized first) and
 * longest-alias-wins: a three-word alias beats the one-word alias inside it,
 * so `Ethena USDe` resolves before `usde`, and `Ethena` never resolves to
 * `ETH` the way substring matching made it.
 *
 * Returns the first match at the longest matching length, scanning left to
 * right, or `undefined` for non-textual kinds and unmatched documents.
 */
export function resolveMention(
  document: Pick<SourceDocument, "kind" | "title" | "text">,
  index: AssetIndex,
): string | undefined {
  if (!TEXTUAL_KINDS.has(document.kind)) {
    return undefined;
  }
  const words = tokenize(`${document.title} ${document.text}`);
  for (let size = MAX_ALIAS_WORDS; size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const ticker = index.aliases.get(words.slice(start, start + size).join(" "));
      if (ticker !== undefined) {
        return ticker;
      }
    }
  }
  return undefined;
}

/**
 * Attach resolved mentions to a document set, keeping documents that already
 * carry an `asset` (connectors fill it for structured kinds). Deterministic,
 * source-neutral, side-effect free.
 *
 * The index defaults to one derived from the documents themselves, which is
 * the production path: a scan resolves its own corpus.
 */
export function resolveMentions(
  documents: readonly SourceDocument[],
  index: AssetIndex = buildAssetIndex(documents),
): SourceDocument[] {
  return documents.map((document) => {
    if (document.asset !== undefined) {
      return document;
    }
    const asset = resolveMention(document, index);
    return asset === undefined ? document : { ...document, asset };
  });
}
