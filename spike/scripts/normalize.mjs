#!/usr/bin/env node
// Spike normalizer — prototype quality by design.
// Reads the latest spike/data/raw/<runId>/ capture, converts every source
// into NormalizedDocuments, deduplicates by content hash and URL, and writes
// one timestamped snapshot: spike/data/snapshots/<runId>/{docs.ndjson,snapshot.json}.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(process.cwd(), "spike", "data");
const rawRoot = join(dataDir, "raw");
const runs = readdirSync(rawRoot).sort();
const runId = runs[runs.length - 1];
if (!runId) throw new Error("no raw runs found; run fetch-sources.mjs first");
const rawDir = join(rawRoot, runId);
const capturedAt = new Date().toISOString();

const readBody = (name) => readFileSync(join(rawDir, name), "utf8");

const docs = [];
const failures = [];

function pushDoc(doc) {
  const text = (doc.text ?? "").replace(/\s+/g, " ").trim();
  const title = (doc.title ?? "").replace(/\s+/g, " ").trim();
  const contentHash = createHash("sha256")
    .update(`${title}\n${text.slice(0, 2000)}`)
    .digest("hex");
  const url = doc.url ?? "";
  const dupe = docs.find((d) => d.contentHash === contentHash || (url && d.url === url));
  if (dupe) return false;
  docs.push({
    docId: contentHash.slice(0, 12),
    contentHash,
    capturedAt,
    ...doc,
    title,
    text,
    url,
  });
  return true;
}

function stripHtml(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// --- Binance market docs -------------------------------------------------
try {
  const tickers = JSON.parse(readBody("binance-tickers.body"));
  for (const t of tickers) {
    const base = t.symbol.replace(/USDT$/, "");
    pushDoc({
      sourceId: "binance",
      kind: "market",
      assets: [base],
      title: `Binance ${base}/USDT 24h ${Number(t.priceChangePercent) >= 0 ? "+" : ""}${t.priceChangePercent}%`,
      text: [
        `${base} bitcoin ethereum solana binance spot ticker 24h`,
        `price ${t.lastPrice} usdt`,
        `change ${t.priceChangePercent} percent`,
        `high ${t.highPrice} low ${t.lowPrice}`,
        `quote volume ${t.quoteVolume} usdt`,
        `trades ${t.count}`,
      ].join(" | "),
      url: `https://www.binance.com/en/trade/${base}_USDT`,
      publishedAt: capturedAt,
      extra: {
        lastPrice: Number(t.lastPrice),
        priceChangePercent: Number(t.priceChangePercent),
        quoteVolume: Number(t.quoteVolume),
      },
    });
  }
} catch (e) {
  failures.push({ source: "binance", error: String(e) });
}

// --- Coinbase market docs ------------------------------------------------
try {
  for (const f of readdirSync(rawDir).filter(
    (f) => f.startsWith("coinbase-stats-") && f.endsWith(".body"),
  )) {
    const base = f
      .replace("coinbase-stats-", "")
      .replace(".body", "")
      .replace("usd", "")
      .toUpperCase();
    const stats = JSON.parse(readBody(f));
    const change = ((Number(stats.last) - Number(stats.open)) / Number(stats.open)) * 100;
    pushDoc({
      sourceId: "coinbase",
      kind: "market",
      assets: [base],
      title: `Coinbase ${base}-USD 24h ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
      text: [
        `${base} bitcoin ethereum solana coinbase exchange spot stats 24h`,
        `price ${stats.last} usd open ${stats.open}`,
        `change ${change.toFixed(2)} percent`,
        `high ${stats.high} low ${stats.low}`,
        `volume ${stats.volume} usd`,
      ].join(" | "),
      url: `https://exchange.coinbase.com/trade/${base}-USD`,
      publishedAt: capturedAt,
      extra: {
        last: Number(stats.last),
        open: Number(stats.open),
        changePercent: Number(change.toFixed(2)),
        volume: Number(stats.volume),
      },
    });
  }
} catch (e) {
  failures.push({ source: "coinbase", error: String(e) });
}

// --- DefiLlama chain and protocol docs ------------------------------------
try {
  const chains = JSON.parse(readBody("defillama-chains.body"));
  for (const c of [...chains].sort((a, b) => b.tvl - a.tvl).slice(0, 15)) {
    pushDoc({
      sourceId: "defillama",
      kind: "tvl-chain",
      assets: [],
      title: `TVL ${c.name} $${(c.tvl / 1e9).toFixed(2)}B`,
      text: `${c.name} chain tvl total value locked ${(c.tvl / 1e9).toFixed(3)} billion usd defillama ${c.tokenSymbol ?? ""}`,
      url: `https://defillama.com/chain/${encodeURIComponent(c.name)}`,
      publishedAt: capturedAt,
      extra: { tvl: c.tvl },
    });
  }
} catch (e) {
  failures.push({ source: "defillama-chains", error: String(e) });
}

try {
  const protocols = JSON.parse(readBody("defillama-protocols.body"));
  const defi = protocols
    .filter((p) => p.category !== "CEX" && p.category !== "Chain")
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 60);
  for (const p of defi) {
    pushDoc({
      sourceId: "defillama",
      kind: "tvl-protocol",
      assets: p.symbol ? [p.symbol] : [],
      title: `TVL ${p.name} $${(p.tvl / 1e9).toFixed(2)}B (${p.category})`,
      text: [
        `${p.name} ${p.symbol ?? ""} protocol tvl total value locked ${(p.tvl / 1e9).toFixed(3)} billion usd defillama`,
        `category ${p.category}`,
        `change 1d ${(p.change_1d ?? 0).toFixed(2)} percent 7d ${(p.change_7d ?? 0).toFixed(2)} percent`,
        `chains ${(p.chains ?? []).slice(0, 6).join(", ")}`,
        stripHtml(p.description ?? "").slice(0, 220),
      ].join(" | "),
      url: p.url || `https://defillama.com/protocol/${p.slug}`,
      publishedAt: capturedAt,
      extra: { tvl: p.tvl, change1d: p.change_1d, change7d: p.change_7d, category: p.category },
    });
  }
} catch (e) {
  failures.push({ source: "defillama-protocols", error: String(e) });
}

// --- RSS/Atom news docs ----------------------------------------------------
// Tolerant prototype extraction: RSS <item> or Atom <entry> blocks.
function extractFeedItems(xml) {
  const blocks = [
    ...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g),
    ...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/g),
  ].map((m) => m[1]);
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? stripHtml(m[1]) : "";
  };
  return blocks.map((b) => {
    let link = pick(b, "link");
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      link = m ? m[1] : "";
    }
    return {
      title: pick(b, "title"),
      link,
      publishedAt: pick(b, "pubDate") || pick(b, "published") || pick(b, "updated"),
      description: pick(b, "description") || pick(b, "summary") || pick(b, "content"),
    };
  });
}

for (const f of readdirSync(rawDir).filter((f) => f.startsWith("rss-") && f.endsWith(".body"))) {
  const feedId = f.replace("rss-", "").replace(".body", "");
  try {
    const items = extractFeedItems(readBody(f)).filter((i) => i.title);
    if (items.length === 0) throw new Error("no items parsed");
    for (const item of items.slice(0, 40)) {
      const parsedDate = item.publishedAt ? new Date(item.publishedAt) : null;
      pushDoc({
        sourceId: feedId,
        kind: "news",
        assets: [],
        title: item.title,
        text: `${item.title}. ${item.description.slice(0, 600)}`,
        url: item.link,
        publishedAt:
          parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      });
    }
  } catch (e) {
    failures.push({ source: feedId, error: String(e) });
  }
}

// --- GitHub release docs ----------------------------------------------------
for (const f of readdirSync(rawDir).filter((f) => f.startsWith("github-") && f.endsWith(".body"))) {
  try {
    const rel = JSON.parse(readBody(f));
    if (!rel.tag_name) throw new Error("no release");
    // Repo name comes from the release URL, not the filename (repo slugs
    // contain hyphens, so the mapping from filenames is ambiguous).
    const repo = (rel.html_url ?? "")
      .replace("https://github.com/", "")
      .split("/")
      .slice(0, 2)
      .join("/");
    pushDoc({
      sourceId: "github",
      kind: "release",
      assets: [],
      title: `Release ${repo} ${rel.tag_name}: ${rel.name ?? ""}`.trim(),
      text: [
        `${repo} github release ${rel.tag_name} ${rel.name ?? ""}`,
        `published ${rel.published_at ?? ""}`,
        stripHtml(rel.body ?? "").slice(0, 500),
      ].join(" | "),
      url: rel.html_url ?? "",
      publishedAt: rel.published_at ?? null,
    });
  } catch (e) {
    failures.push({
      source: `github:${f.replace("github-", "").replace(".body", "")}`,
      error: String(e),
    });
  }
}

// --- Write snapshot ----------------------------------------------------------
const snapshotDir = join(dataDir, "snapshots", runId);
mkdirSync(snapshotDir, { recursive: true });
writeFileSync(
  join(snapshotDir, "docs.ndjson"),
  `${docs.map((d) => JSON.stringify(d)).join("\n")}\n`,
);

const sourceCounts = {};
for (const d of docs) sourceCounts[d.sourceId] = (sourceCounts[d.sourceId] ?? 0) + 1;
const snapshot = {
  runId,
  capturedAt,
  totalDocs: docs.length,
  sourceCounts,
  failures,
  docRefs: docs.map((d) => d.docId),
};
writeFileSync(join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));

console.log(`snapshot: ${snapshotDir}`);
console.log(`docs: ${docs.length}`);
console.log(`sourceCounts: ${JSON.stringify(sourceCounts)}`);
if (failures.length) console.log(`failures: ${JSON.stringify(failures)}`);
