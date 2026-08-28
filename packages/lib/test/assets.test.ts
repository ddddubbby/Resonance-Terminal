import { describe, expect, it } from "vitest";
import {
  type AssetIndex,
  buildAssetIndex,
  makeDocument,
  resolveMention,
  resolveMentions,
  type SourceDocument,
} from "../src/index.js";

const AT = "2026-08-28T00:00:00.000Z";

function market(ticker: string): SourceDocument {
  return makeDocument(
    {
      sourceId: "binance-spot",
      kind: "market",
      url: `https://www.binance.com/en/trade/${ticker}_USDT`,
      title: `Binance ${ticker}/USDT 24h +1%`,
      text: `${ticker} binance spot ticker`,
    },
    AT,
    { asset: ticker },
  );
}

function tvl(name: string, ticker: string): SourceDocument {
  return makeDocument(
    {
      sourceId: "defillama-protocols",
      kind: "tvl",
      url: `https://defillama.com/protocol/${ticker}`,
      title: `TVL ${name} $4.06B (Basis Trading)`,
      text: `${name} ${ticker} protocol tvl defillama`,
    },
    AT,
    { asset: ticker },
  );
}

function news(title: string, text = ""): SourceDocument {
  return makeDocument(
    {
      sourceId: "rss-a",
      kind: "news",
      url: `https://example.invalid/${title.length}`,
      title,
      text,
    },
    AT,
  );
}

/** The shape of a real snapshot: a tradeable tape plus protocol names. */
function index(): AssetIndex {
  return buildAssetIndex([
    market("BTC"),
    market("ETH"),
    market("SOL"),
    market("ENA"),
    market("HEMI"),
    market("BNB"),
    tvl("Ethena USDe", "ENA"),
    tvl("Binance CEX", "BNB"),
    tvl("Aave V3", "AAVE"),
  ]);
}

describe("buildAssetIndex", () => {
  it("takes the tradeable universe from market documents", () => {
    const built = index();
    expect([...built.tradeable].sort()).toEqual(["BNB", "BTC", "ENA", "ETH", "HEMI", "SOL"]);
  });

  it("registers protocol names and their first word as aliases", () => {
    const built = index();
    expect(built.aliases.get("ethena usde")).toBe("ENA");
    expect(built.aliases.get("ethena")).toBe("ENA");
  });

  it("ignores protocol names whose ticker is not tradeable", () => {
    // AAVE has a TVL row but no exchange quote in this snapshot.
    expect(index().aliases.has("aave v3")).toBe(false);
  });

  it("denies venue names that appear in prose without being the subject", () => {
    // "Binance CEX" maps to BNB upstream; taking it would tag much of the corpus.
    expect(index().aliases.has("binance")).toBe(false);
  });

  it("maps common names of majors onto their tickers", () => {
    const built = index();
    expect(built.aliases.get("bitcoin")).toBe("BTC");
    expect(built.aliases.get("ethereum")).toBe("ETH");
    expect(built.aliases.get("solana")).toBe("SOL");
  });
});

describe("resolveMention", () => {
  it("does not match an alias inside a longer word", () => {
    // The regression that made every scored run zero: substring matching read
    // "Ethena" as "eth", so the ENA narrative was never joined to the ENA move.
    const resolved = resolveMention(news("Ethena proposes revenue-funded buybacks"), index());
    expect(resolved).not.toBe("ETH");
    expect(resolved).toBe("ENA");
  });

  it("resolves the ticker itself", () => {
    expect(resolveMention(news("ENA buybacks approved"), index())).toBe("ENA");
  });

  it("prefers the longest matching alias", () => {
    // "ethena usde" (two words) must win over "ethena" (one word).
    const built = buildAssetIndex([market("ENA"), market("USDE"), tvl("Ethena USDe", "ENA")]);
    expect(resolveMention(news("Ethena USDe supply grows"), built)).toBe("ENA");
  });

  it("returns undefined for structured kinds", () => {
    expect(resolveMention(market("ENA"), index())).toBeUndefined();
  });

  it("returns undefined when nothing in the vocabulary appears", () => {
    expect(resolveMention(news("Generic governance vote passes"), index())).toBeUndefined();
  });

  it("matches case-insensitively across title and text", () => {
    expect(resolveMention(news("Upgrade ships", "the hemi rollup shipped"), index())).toBe("HEMI");
  });
});

describe("resolveMentions", () => {
  it("keeps assets that connectors already provided", () => {
    const existing = makeDocument(
      {
        sourceId: "rss-a",
        kind: "news",
        url: "https://example.invalid/7",
        title: "ENA news",
        text: "",
      },
      AT,
      { asset: "CUSTOM" },
    );
    expect(resolveMentions([existing], index())[0]?.asset).toBe("CUSTOM");
  });

  it("derives an index from the documents when none is supplied", () => {
    const resolved = resolveMentions([
      market("ENA"),
      tvl("Ethena USDe", "ENA"),
      news("Ethena buybacks"),
    ]);
    expect(resolved[2]?.asset).toBe("ENA");
  });

  it("resolves nothing when the corpus carries no tradeable universe", () => {
    // Narrative documents alone are textual, so an index built from them is
    // empty. This is why the observation builder indexes the whole corpus.
    expect(resolveMentions([news("Ethena buybacks")])[0]?.asset).toBeUndefined();
  });
});
