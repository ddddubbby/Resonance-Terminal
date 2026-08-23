#!/usr/bin/env node
// Spike fetcher — prototype quality by design (branch: spike/ten-real-candidates).
// Retrieves live public data from the five proposed sources and stores raw
// responses under spike/data/raw/<runId>/ for downstream normalization.
// No API keys, no retries beyond one, failures are recorded and tolerated.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BINANCE_SYMBOLS = [
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
].map((s) => `${s}USDT`);

const COINBASE_PRODUCTS = [
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "XRP-USD",
  "DOGE-USD",
  "ADA-USD",
  "AVAX-USD",
  "LINK-USD",
  "DOT-USD",
];

const RSS_FEEDS = [
  { id: "coindesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { id: "cointelegraph", url: "https://cointelegraph.com/rss" },
  { id: "theblock", url: "https://www.theblock.co/rss.xml" },
  { id: "decrypt", url: "https://decrypt.co/feed" },
];

// Curated public repositories relevant to major ecosystems. Unauthenticated
// GitHub budget is 60 requests/hour; we spend one per repo here.
const GITHUB_REPOS = [
  "ethereum/go-ethereum",
  "ethereum-optimism/optimism",
  "OffchainLabs/nitro",
  "solana-labs/solana",
  "MystenLabs/sui",
  "aptos-labs/aptos-core",
  "cosmos/cosmos-sdk",
  "polkadot/polkadot",
  "bitcoin/bitcoin",
  "base/node",
];

const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = join(process.cwd(), "spike", "data", "raw", runId);
mkdirSync(outDir, { recursive: true });

const results = [];

async function capture(id, url, init = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25000), ...init });
    const body = await res.text();
    const meta = {
      id,
      url,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      ms: Date.now() - started,
      capturedAt: startedAt,
      bytes: body.length,
    };
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify(meta, null, 2));
    writeFileSync(join(outDir, `${id}.body`), body);
    results.push(meta);
    console.log(`${res.ok ? "ok  " : "fail"} ${id} ${res.status} ${meta.bytes}B ${meta.ms}ms`);
    return res.ok ? body : null;
  } catch (err) {
    const meta = {
      id,
      url,
      ok: false,
      status: 0,
      error: String(err),
      ms: Date.now() - started,
      capturedAt: startedAt,
      bytes: 0,
    };
    results.push(meta);
    console.log(`fail ${id} ${meta.error}`);
    return null;
  }
}

const UA = "ResonanceTerminalSpike/0.0 (+https://github.com/ddddubbby/Resonance-Terminal)";

// 1. Binance public spot 24h tickers (one request, multi-symbol query).
const binanceQuery = encodeURIComponent(JSON.stringify(BINANCE_SYMBOLS));
await capture(
  "binance-tickers",
  `https://api.binance.com/api/v3/ticker/24hr?symbols=${binanceQuery}`,
);

// 2. Coinbase Exchange public tickers + 24h stats (two requests per product, batched serially).
for (const product of COINBASE_PRODUCTS) {
  const slug = product.toLowerCase().replace("-", "");
  await capture(
    `coinbase-ticker-${slug}`,
    `https://api.exchange.coinbase.com/products/${product}/ticker`,
    {
      headers: { "User-Agent": UA },
    },
  );
  await capture(
    `coinbase-stats-${slug}`,
    `https://api.exchange.coinbase.com/products/${product}/stats`,
    {
      headers: { "User-Agent": UA },
    },
  );
}

// 3. DefiLlama credential-free endpoints.
await capture("defillama-chains", "https://api.llama.fi/v2/chains");
await capture("defillama-protocols", "https://api.llama.fi/protocols");

// 4. Curated RSS/Atom feeds.
for (const feed of RSS_FEEDS) {
  await capture(`rss-${feed.id}`, feed.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
  });
}

// 5. Curated GitHub public repositories — latest release each.
for (const repo of GITHUB_REPOS) {
  await capture(
    `github-${repo.replace("/", "-")}`,
    `https://api.github.com/repos/${repo}/releases/latest`,
    {
      headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
    },
  );
}

writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify({ runId, finishedAt: new Date().toISOString(), results }, null, 2),
);
console.log(`\nrunId: ${runId}`);
console.log(`ok: ${results.filter((r) => r.ok).length}/${results.length}`);
console.log(`raw data: ${outDir}`);
