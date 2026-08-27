/**
 * Research connectors: DefiLlama, RSS/Atom feeds, GitHub releases.
 *
 * Transport-level like the market connectors: one endpoint per connector,
 * recorded outcomes, injectable fetch. Feed payloads are kept as raw XML
 * text; XML interpretation belongs to the normalize stage.
 *
 * The default feed and repo lists are seeded by `spike/ten-real-candidates`
 * and re-curated for traction: stagnant sources were dropped in favor of
 * actively releasing ones. Robinhood Chain has no machine-readable public
 * channel (no public repo, no RSS on its newsroom or blog), so its momentum
 * signal comes from DefiLlama TVL in the protocols capture and from the
 * Arbitrum stack repos in {@link DEFAULT_REPOS}.
 */

import {
  type CapturingConnector,
  fetchJsonCapture,
  fetchTextCapture,
  type HttpConnectorOptions,
  type RawCapture,
  toConnectorResult,
} from "./connectors.js";
import type { ConnectorResult } from "./index.js";

/** DefiLlama protocol list with TVL and category per protocol. */
export class DefiLlamaProtocolsConnector implements CapturingConnector {
  readonly id = "defillama-protocols";
  readonly kind = "tvl" as const;
  static readonly url = "https://api.llama.fi/protocols";

  constructor(private readonly options: HttpConnectorOptions = {}) {}

  async fetchCapture(): Promise<RawCapture> {
    return fetchJsonCapture(this.id, DefiLlamaProtocolsConnector.url, this.options);
  }

  async fetch(): Promise<ConnectorResult> {
    return toConnectorResult(await this.fetchCapture(), this.kind);
  }
}

/** Browser-like UA: several feeds reject library user agents. */
const FEED_HEADERS = { "user-agent": "Mozilla/5.0 (compatible)" } as const;

/** One RSS/Atom feed. Payload is the raw XML/Atom body text. */
export class FeedConnector implements CapturingConnector {
  readonly id: string;
  readonly kind = "feed" as const;

  constructor(
    id: string,
    readonly url: string,
    private readonly options: HttpConnectorOptions = {},
  ) {
    this.id = id;
  }

  async fetchCapture(): Promise<RawCapture> {
    return fetchTextCapture(this.id, this.url, {
      ...this.options,
      headers: { ...FEED_HEADERS, ...this.options.headers },
    });
  }

  async fetch(): Promise<ConnectorResult> {
    return toConnectorResult(await this.fetchCapture(), this.kind);
  }
}

/** Latest release of one public GitHub repository (unauthenticated). */
export class GitHubReleasesConnector implements CapturingConnector {
  readonly id: string;
  readonly kind = "repo" as const;
  readonly url: string;

  constructor(
    readonly owner: string,
    readonly repo: string,
    private readonly options: HttpConnectorOptions = {},
  ) {
    this.id = `github-${owner}-${repo}`;
    this.url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  }

  async fetchCapture(): Promise<RawCapture> {
    return fetchJsonCapture(this.id, this.url, this.options);
  }

  async fetch(): Promise<ConnectorResult> {
    return toConnectorResult(await this.fetchCapture(), this.kind);
  }
}

/** The RSS/Atom feeds proven by the spike. */
export const DEFAULT_FEEDS: ReadonlyArray<{ readonly id: string; readonly url: string }> = [
  { id: "rss-coindesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { id: "rss-cointelegraph", url: "https://cointelegraph.com/rss" },
  { id: "rss-theblock", url: "https://www.theblock.co/rss.xml" },
  { id: "rss-decrypt", url: "https://decrypt.co/feed" },
  // Alternative, less-consensus feeds earned during spike recalibration.
  { id: "rss-thedefiant", url: "https://thedefiant.io/api/feeds/rss" },
  { id: "rss-blockworks", url: "https://www.blockworks.co/feed" },
  { id: "rss-dlnews", url: "https://www.dlnews.com/arc/outboundfeeds/rss/" },
];

/**
 * Curated public repositories proven by the spike, re-curated for traction:
 * `solana-labs/solana` (frozen at v1.18 since 2024-10) was replaced by the
 * active validator `anza-xyz/agave`, and the release-less `polkadot/polkadot`
 * by the momentum Ethereum client `paradigmxyz/reth`. Unauthenticated GitHub
 * budget is 60 requests/hour; one request per repo keeps this cheap.
 */
export const DEFAULT_REPOS: ReadonlyArray<string> = [
  "ethereum/go-ethereum",
  "ethereum-optimism/optimism",
  "OffchainLabs/nitro",
  "anza-xyz/agave",
  "paradigmxyz/reth",
  "MystenLabs/sui",
  "aptos-labs/aptos-core",
  "cosmos/cosmos-sdk",
  "bitcoin/bitcoin",
  "base/node",
  "hyperliquid-dex/hyperliquid-python-sdk",
];

/** Feed connectors for the default list, in list order. */
export function feedConnectors(options: HttpConnectorOptions = {}): FeedConnector[] {
  return DEFAULT_FEEDS.map((feed) => new FeedConnector(feed.id, feed.url, options));
}

/** GitHub release connectors for the default repos, in list order. */
export function repoConnectors(options: HttpConnectorOptions = {}): GitHubReleasesConnector[] {
  return DEFAULT_REPOS.map((repo) => {
    const slash = repo.indexOf("/");
    return new GitHubReleasesConnector(repo.slice(0, slash), repo.slice(slash + 1), options);
  });
}

/** The research connectors shipped by this branch, in stable order. */
export function researchConnectors(options: HttpConnectorOptions = {}): CapturingConnector[] {
  return [
    new DefiLlamaProtocolsConnector(options),
    ...feedConnectors(options),
    ...repoConnectors(options),
  ];
}
