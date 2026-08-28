import { describe, expect, it } from "vitest";
import type { RawCapture } from "../src/connectors.js";
import { contentHashOf, docIdOf } from "../src/index.js";
import { extractFeedItems, normalizeCaptures, screenMovers, stripHtml } from "../src/normalize.js";

function capture(connectorId: string, payload: unknown): RawCapture {
  return {
    connectorId,
    url: `https://example.com/${connectorId}`,
    ok: true,
    fetchedAt: "2026-08-27T12:00:00.000Z",
    payload,
  };
}

function failedCapture(connectorId: string): RawCapture {
  return {
    connectorId,
    url: `https://example.com/${connectorId}`,
    ok: false,
    fetchedAt: "2026-08-27T12:00:00.000Z",
    error: "HTTP 503",
  };
}

describe("stripHtml and extractFeedItems", () => {
  it("strips CDATA, tags, and entities", () => {
    expect(stripHtml("<![CDATA[<b>a</b> &amp; b]]>")).toBe("a & b");
  });

  it("parses RSS items and Atom entries with href links", () => {
    const xml = [
      "<rss><channel>",
      "<item><title><![CDATA[ETF flows]]></title><link>https://x.com/1</link><pubDate>Wed, 26 Aug 2026 10:00:00 GMT</pubDate><description>Big flows.</description></item>",
      '<entry><title>Stable act</title><link href="https://x.com/2"/><updated>2026-08-26T11:00:00Z</updated><summary>The act passed.</summary></entry>',
      "</channel></rss>",
    ].join("");
    const items = extractFeedItems(xml);
    expect(items.length).toBe(2);
    expect(items[0]?.title).toBe("ETF flows");
    expect(items[0]?.link).toBe("https://x.com/1");
    expect(items[1]?.link).toBe("https://x.com/2");
    expect(items[1]?.description).toBe("The act passed.");
  });
});

describe("screenMovers", () => {
  it("screens gainers, losers, and volume leaders off the tracked tape", () => {
    const tape = [
      {
        symbol: "SOLUSDT",
        lastPrice: "1",
        priceChangePercent: "9.0",
        quoteVolume: "900000000",
        count: 1,
      },
      {
        symbol: "PEPEUSDT",
        lastPrice: "1",
        priceChangePercent: "12.0",
        quoteVolume: "8000000",
        count: 1,
      },
      {
        symbol: "LOWUSDT",
        lastPrice: "1",
        priceChangePercent: "-8.0",
        quoteVolume: "9000000",
        count: 1,
      },
      {
        symbol: "VOLUSDT",
        lastPrice: "1",
        priceChangePercent: "0.5",
        quoteVolume: "500000000",
        count: 1,
      },
      {
        symbol: "USDCUSDT",
        lastPrice: "1",
        priceChangePercent: "20.0",
        quoteVolume: "90000000",
        count: 1,
      },
      {
        symbol: "BTCUPUSDT",
        lastPrice: "1",
        priceChangePercent: "25.0",
        quoteVolume: "90000000",
        count: 1,
      },
      {
        symbol: "TINYUSDT",
        lastPrice: "1",
        priceChangePercent: "30.0",
        quoteVolume: "1000",
        count: 1,
      },
    ];
    const moves = screenMovers(capture("binance-spot", tape));
    const assets = moves.map((m) => m.asset);
    expect(assets).toContain("PEPE");
    expect(assets).toContain("LOW");
    expect(assets).toContain("VOL");
    // Tracked assets are excluded from the volume screen only, not the
    // gainer/loser screens (spike rules).
    expect(assets).toContain("SOL");
    expect(assets).not.toContain("USDC");
    expect(assets).not.toContain("BTCUP");
    expect(assets).not.toContain("TINY");
    expect(moves.find((m) => m.asset === "PEPE")?.changePercent).toBe(12);
  });

  it("returns nothing for failed captures", () => {
    expect(screenMovers(failedCapture("binance-spot"))).toEqual([]);
  });
});

describe("normalizeCaptures", () => {
  it("normalizes every merged connector family into locked documents", () => {
    const captures = [
      capture("binance-spot", [
        {
          symbol: "BTCUSDT",
          lastPrice: "77000",
          priceChangePercent: "0.5",
          highPrice: "78000",
          lowPrice: "76000",
          quoteVolume: "1000000000",
          count: 100,
        },
        { symbol: "ETHBTC", lastPrice: "1", priceChangePercent: "0", quoteVolume: "1", count: 1 },
      ]),
      capture("coinbase-spot", [
        { id: "BTC-USD", display_name: "BTC-USD" },
        { id: "WEIRD-EUR", display_name: "WEIRD-EUR" },
      ]),
      capture("defillama-protocols", [
        {
          name: "Lido",
          slug: "lido",
          symbol: "LDO",
          tvl: 2e10,
          category: "Liquid Staking",
          change_1d: 1,
          change_7d: 2,
          chains: ["Ethereum"],
          description: "<p>Staking.</p>",
          url: "https://lido.fi",
        },
        { name: "Binance CEX", slug: "binance", tvl: 9e10, category: "CEX" },
      ]),
      capture(
        "rss-coindesk",
        "<rss><item><title>ETF flows</title><link>https://x.com/1</link><description>Big.</description></item></rss>",
      ),
      capture("github-ethereum-go-ethereum", {
        tag_name: "v1.16.0",
        name: "Titan",
        body: "<b>Notes</b>",
        html_url: "https://github.com/ethereum/go-ethereum/releases/tag/v1.16.0",
        published_at: "2026-08-20T00:00:00Z",
      }),
      failedCapture("rss-theblock"),
      capture("unknown-connector", { anything: true }),
    ];
    const docs = normalizeCaptures(captures);
    const kinds = docs.map((doc) => doc.kind).sort();
    // The `mover` document is the screened view of an asset already present as
    // a `market` row. It survives deduplication only because normalization
    // gives it a distinct url; before that fix every mover was dropped and the
    // alpha-signals sheet rendered empty on every run.
    expect(kinds).toEqual(["market", "market", "market", "mover", "news", "release", "tvl"]);

    const btc = docs.find((doc) => doc.asset === "BTC" && doc.sourceId === "binance-spot");
    expect(btc?.title).toContain("BTC/USDT 24h +0.5%");
    // Locked identity: the content hash of sourceId|kind|url|title|text.
    expect(btc?.docId).toBe(
      docIdOf(
        contentHashOf({
          sourceId: btc?.sourceId ?? "",
          kind: "market",
          url: btc?.url ?? "",
          title: btc?.title ?? "",
          text: btc?.text ?? "",
        }),
      ),
    );

    const weird = docs.find((doc) => doc.title.includes("WEIRD-EUR"));
    expect(weird?.asset).toBeUndefined();

    const tvl = docs.find((doc) => doc.kind === "tvl");
    expect(tvl?.title).toBe("TVL Lido $20.00B (Liquid Staking)");
    expect(docs.some((doc) => doc.title.includes("Binance CEX"))).toBe(false);

    const news = docs.find((doc) => doc.kind === "news");
    expect(news?.title).toBe("ETF flows");
    expect(news?.sourceId).toBe("rss-coindesk");

    const release = docs.find((doc) => doc.kind === "release");
    expect(release?.title).toContain("ethereum/go-ethereum v1.16.0");
    expect(release?.publishedAt).toBe("2026-08-20T00:00:00Z");
  });

  it("deduplicates identical documents", () => {
    const binance = capture("binance-spot", [
      {
        symbol: "BTCUSDT",
        lastPrice: "77000",
        priceChangePercent: "0.5",
        quoteVolume: "1000000000",
        count: 100,
      },
    ]);
    const once = normalizeCaptures([binance]);
    const twice = normalizeCaptures([binance, binance]);
    expect(twice.length).toBe(once.length);
  });
});
