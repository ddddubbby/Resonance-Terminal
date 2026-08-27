/**
 * HTTP connector plumbing and market connectors: Binance and Coinbase spot.
 *
 * Connectors are transport-level: they fetch one public endpoint and report
 * a locked {@link ConnectorResult}. They never throw on source failures;
 * every outcome is a recorded result. Interpretation of payloads
 * (normalization into documents) belongs to later lifecycle stages.
 *
 * The fetch implementation is injectable so tests run fully offline.
 */

import type { Connector, ConnectorResult } from "./index.js";

/** Injectable fetch, matching the global signature. */
export type FetchFn = typeof fetch;

/** Default request budget for connector fetches. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/** Options shared by the HTTP connectors. */
export interface HttpConnectorOptions {
  /** Injectable fetch; defaults to the global `fetch`. */
  readonly fetcher?: FetchFn;
  /** Request budget in milliseconds. */
  readonly timeoutMs?: number;
  /** Extra request headers; override the defaults when keys collide. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** A connector result plus the raw payload when the fetch succeeded. */
export interface RawCapture {
  readonly connectorId: string;
  readonly url: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
  /** ISO-8601 fetch time. */
  readonly fetchedAt: string;
  /** Raw payload (parsed JSON or body text); present exactly when `ok` is true. */
  readonly payload?: unknown;
}

/**
 * A connector that also exposes its raw payload for the snapshot layer to
 * persist. Additive to the locked `Connector` interface, never a redefinition.
 */
export interface CapturingConnector extends Connector {
  fetchCapture(): Promise<RawCapture>;
}

/** Project a raw capture onto the locked {@link ConnectorResult} shape. */
export function toConnectorResult(capture: RawCapture, kind: Connector["kind"]): ConnectorResult {
  return {
    connectorId: capture.connectorId,
    kind,
    ok: capture.ok,
    ...(capture.status === undefined ? {} : { status: capture.status }),
    ...(capture.error === undefined ? {} : { error: capture.error }),
    capturedAt: capture.fetchedAt,
  };
}

/** Shared HTTP fetch: one GET, recorded outcome, no throws. */
async function fetchCore(
  connectorId: string,
  url: string,
  options: HttpConnectorOptions,
  read: (response: Response) => Promise<unknown>,
): Promise<RawCapture> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "resonance-terminal/0.0.0", ...options.headers },
    });
    if (!response.ok) {
      return {
        connectorId,
        url,
        ok: false,
        status: response.status,
        fetchedAt,
        error: `HTTP ${response.status}`,
      };
    }
    const payload = await read(response);
    return { connectorId, url, ok: true, status: response.status, fetchedAt, payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { connectorId, url, ok: false, fetchedAt, error: message };
  }
}

/** Fetch one endpoint and parse the body as JSON. */
export function fetchJsonCapture(
  connectorId: string,
  url: string,
  options: HttpConnectorOptions = {},
): Promise<RawCapture> {
  return fetchCore(connectorId, url, options, (response) => response.json());
}

/** Fetch one endpoint and keep the body as text (e.g. RSS/Atom XML). */
export function fetchTextCapture(
  connectorId: string,
  url: string,
  options: HttpConnectorOptions = {},
): Promise<RawCapture> {
  return fetchCore(connectorId, url, options, (response) => response.text());
}

/**
 * Binance full spot tape: 24h ticker stats for every symbol.
 *
 * Uses `data-api.binance.vision`, Binance's official public market-data
 * host: no key, and reachable from regions where the trading API host
 * answers HTTP 451.
 */
export class BinanceSpotConnector implements CapturingConnector {
  readonly id = "binance-spot";
  readonly kind = "market" as const;
  static readonly url = "https://data-api.binance.vision/api/v3/ticker/24hr";

  constructor(private readonly options: HttpConnectorOptions = {}) {}

  async fetchCapture(): Promise<RawCapture> {
    return fetchJsonCapture(this.id, BinanceSpotConnector.url, this.options);
  }

  async fetch(): Promise<ConnectorResult> {
    return toConnectorResult(await this.fetchCapture(), this.kind);
  }
}

/** Coinbase Exchange product list with latest price and volume stats. */
export class CoinbaseSpotConnector implements CapturingConnector {
  readonly id = "coinbase-spot";
  readonly kind = "market" as const;
  static readonly url = "https://api.exchange.coinbase.com/products";

  constructor(private readonly options: HttpConnectorOptions = {}) {}

  async fetchCapture(): Promise<RawCapture> {
    return fetchJsonCapture(this.id, CoinbaseSpotConnector.url, this.options);
  }

  async fetch(): Promise<ConnectorResult> {
    return toConnectorResult(await this.fetchCapture(), this.kind);
  }
}

/** The market connectors shipped by this branch, in stable order. */
export function marketConnectors(options: HttpConnectorOptions = {}): CapturingConnector[] {
  return [new BinanceSpotConnector(options), new CoinbaseSpotConnector(options)];
}
