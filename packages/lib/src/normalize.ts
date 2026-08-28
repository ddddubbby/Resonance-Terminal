/**
 * The normalize stage: raw captures into locked {@link SourceDocument}s.
 *
 * Faithful port of the spike's proven rules, rebuilt on the locked
 * contracts: identity comes from {@link contentHashOf} (not the spike's
 * title-hash), deduplication from {@link dedupeDocuments}, and one `asset`
 * token instead of the spike's `assets` array. Structured numbers stay in
 * the text (the locked shape has no `extra` field); reference sheets render
 * excerpts, and the mover screening is exported separately for scoring.
 */

import type { RawCapture } from "./connectors.js";
import { type AssetMove, dedupeDocuments, makeDocument, type SourceDocument } from "./index.js";

/** Strip HTML/entities from feed and release bodies (spike rules). */
export function stripHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll(/&#39;|&apos;/g, "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&nbsp;", " ")
    .replaceAll(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** One parsed feed item. */
export interface FeedItem {
  readonly title: string;
  readonly link: string;
  readonly publishedAt: string;
  readonly description: string;
}

/**
 * Tolerant RSS/Atom extraction (spike rules): `<item>` or `<entry>` blocks,
 * title/link/date/description fields, Atom `href` links.
 */
export function extractFeedItems(xml: string): FeedItem[] {
  const blocks = [
    ...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g),
    ...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/g),
  ].map((match) => match[1] ?? "");
  const pick = (block: string, tag: string): string => {
    const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return match?.[1] !== undefined ? stripHtml(match[1]) : "";
  };
  return blocks.map((block) => {
    let link = pick(block, "link");
    if (link === "") {
      const match = block.match(/<link[^>]*href="([^"]+)"/i);
      link = match?.[1] ?? "";
    }
    return {
      title: pick(block, "title"),
      link,
      publishedAt: pick(block, "pubDate") || pick(block, "published") || pick(block, "updated"),
      description: pick(block, "description") || pick(block, "summary") || pick(block, "content"),
    };
  });
}

/** Maximum feed items kept per feed capture. */
export const MAX_FEED_ITEMS = 40;

/** Assets on the tracked tape, excluded from the off-radar mover screens. */
export const TRACKED_ASSETS: ReadonlySet<string> = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "DOT",
  "TON",
  "TRX",
]);

/** Minimum quote volume for a mover-eligible pair (spike floor, $5M). */
export const MOVER_MIN_QUOTE_VOLUME = 5_000_000;

interface TickerRow {
  readonly symbol: string;
  readonly lastPrice: string;
  readonly priceChangePercent: string;
  readonly highPrice?: string;
  readonly lowPrice?: string;
  readonly quoteVolume: string;
  readonly count?: number;
  readonly openPrice?: string;
}

/** The spike's eligibility filter for the mover screens. */
function moverEligible(t: TickerRow): boolean {
  return (
    t.symbol.endsWith("USDT") &&
    !/^(USDC|FDUSD|TUSD|DAI|USDP|EUR|EURI|AEUR|XUSD|USD1|BFUSD)/.test(t.symbol) &&
    !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) &&
    Number(t.quoteVolume) >= MOVER_MIN_QUOTE_VOLUME
  );
}

/**
 * Screen off-radar movers from a full Binance tape capture (spike rules):
 * the twelve top gainers, the eight top losers, and the ten volume leaders
 * outside the tracked tape. Stable and leveraged pairs excluded.
 */
export function screenMovers(capture: RawCapture): AssetMove[] {
  if (!capture.ok || !Array.isArray(capture.payload)) {
    return [];
  }
  const eligible = (capture.payload as TickerRow[]).filter(moverEligible);
  const byChange = [...eligible].sort(
    (a, b) => Number(b.priceChangePercent) - Number(a.priceChangePercent),
  );
  const byVolume = [...eligible]
    .filter((t) => !TRACKED_ASSETS.has(t.symbol.replace(/USDT$/, "")))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume));
  const screened = [...byChange.slice(0, 12), ...byChange.slice(-8), ...byVolume.slice(0, 10)];
  const seen = new Set<string>();
  const moves: AssetMove[] = [];
  for (const t of screened) {
    const asset = t.symbol.replace(/USDT$/, "");
    if (seen.has(asset)) {
      continue;
    }
    seen.add(asset);
    moves.push({ asset, changePercent: Number(t.priceChangePercent) });
  }
  return moves;
}

function binanceDocuments(capture: RawCapture, capturedAt: string): SourceDocument[] {
  if (!capture.ok || !Array.isArray(capture.payload)) {
    return [];
  }
  const docs: SourceDocument[] = [];
  for (const t of capture.payload as TickerRow[]) {
    if (!t.symbol.endsWith("USDT")) {
      continue;
    }
    const base = t.symbol.replace(/USDT$/, "");
    const change = Number(t.priceChangePercent);
    docs.push(
      makeDocument(
        {
          sourceId: capture.connectorId,
          kind: "market",
          url: `https://www.binance.com/en/trade/${base}_USDT`,
          title: `Binance ${base}/USDT 24h ${change >= 0 ? "+" : ""}${t.priceChangePercent}%`,
          text: [
            `${base} bitcoin ethereum solana binance spot ticker 24h`,
            `price ${t.lastPrice} usdt`,
            `change ${t.priceChangePercent} percent`,
            `high ${t.highPrice ?? "?"} low ${t.lowPrice ?? "?"}`,
            `quote volume ${t.quoteVolume} usdt`,
            `trades ${t.count ?? "?"}`,
          ].join(" | "),
        },
        capturedAt,
        { publishedAt: capturedAt, asset: base },
      ),
    );
  }
  for (const move of screenMovers(capture)) {
    docs.push(
      makeDocument(
        {
          sourceId: capture.connectorId,
          kind: "mover",
          // The `#mover` fragment is load-bearing, not cosmetic: deduplication
          // is first-write-wins on (sourceId, url), and the market document for
          // the same asset is written first from the same tape. Without a
          // distinct url every screened mover was silently dropped, which is
          // why the alpha-signals sheet rendered empty on every run.
          url: `https://www.binance.com/en/trade/${move.asset}_USDT#mover`,
          title: `Mover ${move.asset}/USDT ${move.changePercent >= 0 ? "+" : ""}${move.changePercent}%`,
          text: [
            `${move.asset} binance spot mover off radar`,
            `change ${move.changePercent} percent`,
          ].join(" | "),
        },
        capturedAt,
        { publishedAt: capturedAt, asset: move.asset },
      ),
    );
  }
  return docs;
}

interface CoinbaseProduct {
  readonly id: string;
  readonly display_name?: string;
}

/** Coinbase product list (the merged connector's single endpoint). */
function coinbaseDocuments(capture: RawCapture, capturedAt: string): SourceDocument[] {
  if (!capture.ok || !Array.isArray(capture.payload)) {
    return [];
  }
  const docs: SourceDocument[] = [];
  for (const product of capture.payload as CoinbaseProduct[]) {
    const [base, quote] = product.id.split("-");
    if (base === undefined || quote === undefined) {
      continue;
    }
    const asset = quote === "USD" || quote === "USDC" ? base : undefined;
    docs.push(
      makeDocument(
        {
          sourceId: capture.connectorId,
          kind: "market",
          url: `https://exchange.coinbase.com/trade/${product.id}`,
          title: `Coinbase ${product.display_name ?? product.id}`,
          text: [
            `${base} coinbase exchange spot product ${product.id}`,
            `${product.display_name ?? base}`,
          ].join(" | "),
        },
        capturedAt,
        { publishedAt: capturedAt, ...(asset !== undefined ? { asset } : {}) },
      ),
    );
  }
  return docs;
}

/** DefiLlama category lens (spike recalibration): full coverage above a floor. */
export const ALPHA_CATEGORIES: readonly string[] = ["RWA", "Liquid Staking", "Derivatives"];

/** DefiLlama protocol TVL floor for the category lens. */
export const CATEGORY_TVL_FLOOR = 20_000_000;

/** Maximum protocols kept by TVL rank outside the category lens. */
export const MAX_TVL_PROTOCOLS = 60;

interface ProtocolRow {
  readonly name: string;
  readonly slug?: string;
  readonly symbol?: string;
  readonly tvl?: number;
  readonly category?: string;
  readonly change_1d?: number;
  readonly change_7d?: number;
  readonly chains?: readonly string[];
  readonly description?: string;
  readonly url?: string;
}

function defillamaDocuments(capture: RawCapture, capturedAt: string): SourceDocument[] {
  if (!capture.ok || !Array.isArray(capture.payload)) {
    return [];
  }
  const protocols = capture.payload as ProtocolRow[];
  const ranked = protocols
    .filter((p) => p.category !== "CEX" && p.category !== "Chain")
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
    .slice(0, MAX_TVL_PROTOCOLS);
  const lens = protocols.filter(
    (p) => ALPHA_CATEGORIES.includes(p.category ?? "") && (p.tvl ?? 0) >= CATEGORY_TVL_FLOOR,
  );
  const docs: SourceDocument[] = [];
  for (const p of [...ranked, ...lens]) {
    const tvl = p.tvl ?? 0;
    docs.push(
      makeDocument(
        {
          sourceId: capture.connectorId,
          kind: "tvl",
          url: p.url || `https://defillama.com/protocol/${p.slug ?? p.name}`,
          title: `TVL ${p.name} $${(tvl / 1e9).toFixed(2)}B (${p.category ?? "?"})`,
          text: [
            `${p.name} ${p.symbol ?? ""} protocol tvl total value locked ${(tvl / 1e9).toFixed(3)} billion usd defillama`,
            `category ${p.category ?? "?"}`,
            `change 1d ${(p.change_1d ?? 0).toFixed(2)} percent 7d ${(p.change_7d ?? 0).toFixed(2)} percent`,
            `chains ${(p.chains ?? []).slice(0, 6).join(", ")}`,
            stripHtml(p.description).slice(0, 220),
          ].join(" | "),
        },
        capturedAt,
        { publishedAt: capturedAt, ...(p.symbol !== undefined ? { asset: p.symbol } : {}) },
      ),
    );
  }
  return docs;
}

function feedDocuments(capture: RawCapture, capturedAt: string): SourceDocument[] {
  if (!capture.ok || typeof capture.payload !== "string") {
    return [];
  }
  const items = extractFeedItems(capture.payload).filter((item) => item.title !== "");
  const docs: SourceDocument[] = [];
  for (const item of items.slice(0, MAX_FEED_ITEMS)) {
    const parsed = new Date(item.publishedAt);
    docs.push(
      makeDocument(
        {
          sourceId: capture.connectorId,
          kind: "news",
          url: item.link,
          title: item.title,
          text: `${item.title}. ${item.description.slice(0, 600)}`,
        },
        capturedAt,
        {
          ...(Number.isNaN(parsed.getTime()) || item.publishedAt === ""
            ? {}
            : { publishedAt: parsed.toISOString() }),
        },
      ),
    );
  }
  return docs;
}

interface ReleaseRow {
  readonly tag_name?: string;
  readonly name?: string;
  readonly body?: string;
  readonly html_url?: string;
  readonly published_at?: string;
}

function releaseDocuments(capture: RawCapture, capturedAt: string): SourceDocument[] {
  if (!capture.ok || capture.payload === null || typeof capture.payload !== "object") {
    return [];
  }
  const rel = capture.payload as ReleaseRow;
  if (rel.tag_name === undefined) {
    return [];
  }
  // Repo name from the release URL, not the connector id (unambiguous).
  const repo = (rel.html_url ?? "")
    .replace("https://github.com/", "")
    .split("/")
    .slice(0, 2)
    .join("/");
  return [
    makeDocument(
      {
        sourceId: capture.connectorId,
        kind: "release",
        url: rel.html_url ?? "",
        title: `Release ${repo} ${rel.tag_name}: ${rel.name ?? ""}`.trim(),
        text: [
          `${repo} github release ${rel.tag_name} ${rel.name ?? ""}`,
          `published ${rel.published_at ?? ""}`,
          stripHtml(rel.body).slice(0, 500),
        ].join(" | "),
      },
      capturedAt,
      { ...(rel.published_at !== undefined ? { publishedAt: rel.published_at } : {}) },
    ),
  ];
}

/**
 * Normalize every capture of a scan into locked documents, deduplicated.
 * Dispatch is by connector id: the fixed connector families of the alpha
 * have stable ids (`binance-spot`, `coinbase-spot`, `defillama-protocols`,
 * `rss-*`, `github-*`). Unknown or failed captures contribute nothing.
 */
export function normalizeCaptures(captures: readonly RawCapture[]): SourceDocument[] {
  const docs: SourceDocument[] = [];
  for (const capture of captures) {
    const capturedAt = capture.fetchedAt;
    if (capture.connectorId === "binance-spot") {
      docs.push(...binanceDocuments(capture, capturedAt));
    } else if (capture.connectorId === "coinbase-spot") {
      docs.push(...coinbaseDocuments(capture, capturedAt));
    } else if (capture.connectorId === "defillama-protocols") {
      docs.push(...defillamaDocuments(capture, capturedAt));
    } else if (capture.connectorId.startsWith("rss-")) {
      docs.push(...feedDocuments(capture, capturedAt));
    } else if (capture.connectorId.startsWith("github-")) {
      docs.push(...releaseDocuments(capture, capturedAt));
    }
  }
  return dedupeDocuments(docs);
}
