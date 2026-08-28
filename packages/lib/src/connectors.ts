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

/**
 * Default response body budget shared by every HTTP connector (16 MiB).
 * The largest measured alpha endpoint is DefiLlama's protocol list at
 * roughly 8.7 MB; the budget leaves headroom without exposing the scan
 * to oversized or decompression-bomb responses.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Options shared by the HTTP connectors. */
export interface HttpConnectorOptions {
  /** Injectable fetch; defaults to the global `fetch`. */
  readonly fetcher?: FetchFn;
  /** Request budget in milliseconds. */
  readonly timeoutMs?: number;
  /** Extra request headers; override the defaults when keys collide. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Response body budget in bytes; defaults to {@link DEFAULT_MAX_RESPONSE_BYTES}. */
  readonly maxResponseBytes?: number;
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

/**
 * Read a response body with a hard byte budget, counted on the decompressed
 * stream. Fails fast on a trustworthy Content-Length, and cancels the body
 * reader the moment the streamed total exceeds the limit.
 */
async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isInteger(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error(`response declared ${declaredBytes} bytes, over the ${maxBytes} byte limit`);
    }
  }
  if (response.body === null) {
    return new Uint8Array(0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.length;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeded the ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/** Shared HTTP fetch: one GET, recorded outcome, no throws on source failures. */
async function fetchCore(
  connectorId: string,
  url: string,
  options: HttpConnectorOptions,
  read: (response: Response) => Promise<unknown>,
): Promise<RawCapture> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error(
      `maxResponseBytes must be a positive integer (got ${String(maxResponseBytes)})`,
    );
  }
  const fetchedAt = new Date().toISOString();
  let status: number | undefined;
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "resonance-terminal/0.0.0", ...options.headers },
    });
    status = response.status;
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
    return {
      connectorId,
      url,
      ok: false,
      ...(status === undefined ? {} : { status }),
      fetchedAt,
      error: message,
    };
  }
}

/** Fetch one endpoint and parse the body as JSON, within the byte budget. */
export function fetchJsonCapture(
  connectorId: string,
  url: string,
  options: HttpConnectorOptions = {},
): Promise<RawCapture> {
  return fetchCore(connectorId, url, options, async (response) => {
    const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const body = await readBoundedBody(response, maxBytes);
    return JSON.parse(new TextDecoder().decode(body));
  });
}

/** Fetch one endpoint and keep the body as text (e.g. RSS/Atom XML), within the byte budget. */
export function fetchTextCapture(
  connectorId: string,
  url: string,
  options: HttpConnectorOptions = {},
): Promise<RawCapture> {
  return fetchCore(connectorId, url, options, async (response) => {
    const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const body = await readBoundedBody(response, maxBytes);
    return new TextDecoder().decode(body);
  });
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
