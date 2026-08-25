import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEEDS,
  DEFAULT_REPOS,
  DefiLlamaProtocolsConnector,
  FeedConnector,
  type FetchFn,
  feedConnectors,
  GitHubReleasesConnector,
  repoConnectors,
  researchConnectors,
} from "../src/index.js";

function respond(status: number, body: string, contentType: string): FetchFn {
  return async () =>
    new Response(body, { status, headers: { "content-type": contentType } }) as Response;
}

describe("DefiLlamaProtocolsConnector", () => {
  it("fetches the protocol list and reports the locked shape", async () => {
    const protocols = [{ name: "Aave", tvl: 1000, category: "Lending" }];
    const connector = new DefiLlamaProtocolsConnector({
      fetcher: respond(200, JSON.stringify(protocols), "application/json"),
    });
    const capture = await connector.fetchCapture();
    expect(capture.connectorId).toBe("defillama-protocols");
    expect(capture.url).toBe(DefiLlamaProtocolsConnector.url);
    expect(capture.payload).toEqual(protocols);
    const result = await connector.fetch();
    expect(result).toMatchObject({ connectorId: "defillama-protocols", kind: "tvl", ok: true });
  });
});

describe("FeedConnector", () => {
  const xml = "<rss><channel><title>Fixture</title></channel></rss>";

  it("keeps the raw XML body as the payload", async () => {
    const connector = new FeedConnector("rss-fixture", "https://example.invalid/feed", {
      fetcher: respond(200, xml, "application/rss+xml"),
    });
    const capture = await connector.fetchCapture();
    expect(capture.ok).toBe(true);
    expect(capture.payload).toBe(xml);
    const result = await connector.fetch();
    expect(result).toMatchObject({ connectorId: "rss-fixture", kind: "feed", ok: true });
  });

  it("sends the browser-like user agent by default", async () => {
    let seen: Record<string, string> | undefined;
    const fetcher: FetchFn = async (_url, init) => {
      seen = init?.headers as Record<string, string> | undefined;
      return new Response(xml, { status: 200 }) as Response;
    };
    await new FeedConnector("rss-fixture", "https://example.invalid/feed", {
      fetcher,
    }).fetchCapture();
    expect(seen?.["user-agent"]).toBe("Mozilla/5.0 (compatible)");
  });

  it("records feed failures without throwing", async () => {
    const connector = new FeedConnector("rss-fixture", "https://example.invalid/feed", {
      fetcher: respond(403, "forbidden", "text/plain"),
    });
    const capture = await connector.fetchCapture();
    expect(capture.ok).toBe(false);
    expect(capture.error).toBe("HTTP 403");
  });
});

describe("GitHubReleasesConnector", () => {
  it("builds the releases URL and id from owner/repo", async () => {
    const release = { tag_name: "v1.0.0" };
    const connector = new GitHubReleasesConnector("ethereum", "go-ethereum", {
      fetcher: respond(200, JSON.stringify(release), "application/json"),
    });
    expect(connector.id).toBe("github-ethereum-go-ethereum");
    expect(connector.url).toBe("https://api.github.com/repos/ethereum/go-ethereum/releases/latest");
    const capture = await connector.fetchCapture();
    expect(capture.payload).toEqual(release);
    const result = await connector.fetch();
    expect(result).toMatchObject({ kind: "repo", ok: true });
  });

  it("records repos without releases as failures", async () => {
    const connector = new GitHubReleasesConnector("polkadot", "polkadot", {
      fetcher: respond(404, "{}", "application/json"),
    });
    const capture = await connector.fetchCapture();
    expect(capture.ok).toBe(false);
    expect(capture.status).toBe(404);
  });
});

describe("default lists and factories", () => {
  it("ships the seven spike-proven feeds with unique ids", () => {
    expect(DEFAULT_FEEDS).toHaveLength(7);
    const ids = DEFAULT_FEEDS.map((feed) => feed.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("rss-"))).toBe(true);
  });

  it("ships the eleven spike-proven repos", () => {
    expect(DEFAULT_REPOS).toHaveLength(11);
    expect(DEFAULT_REPOS).toContain("hyperliquid-dex/hyperliquid-python-sdk");
  });

  it("builds research connectors in stable order: tvl, feeds, repos", () => {
    const connectors = researchConnectors();
    expect(connectors).toHaveLength(1 + DEFAULT_FEEDS.length + DEFAULT_REPOS.length);
    const [first] = connectors;
    expect(first?.id).toBe("defillama-protocols");
    expect(connectors.map((c) => c.kind)).toEqual([
      "tvl",
      ...DEFAULT_FEEDS.map(() => "feed"),
      ...DEFAULT_REPOS.map(() => "repo"),
    ]);
    expect(feedConnectors().map((c) => c.id)).toEqual(DEFAULT_FEEDS.map((f) => f.id));
    const [firstRepo] = repoConnectors();
    expect(firstRepo?.id).toBe("github-ethereum-go-ethereum");
  });
});
