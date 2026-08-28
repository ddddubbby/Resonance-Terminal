/**
 * Connector-specific payload validation, run between fetch and persistence.
 *
 * Connectors stay transport-level (they report a recorded result and never
 * interpret payloads); interpretation lives in normalization. These
 * validators sit between the two: they check that a successful HTTP-200
 * capture actually carries the shape the fixed connector family promises,
 * so a malformed body is recorded as a connector failure instead of being
 * persisted as a raw capture or handed to normalization.
 *
 * Validation is per connector family, dispatched by the fixed connector
 * ids used throughout the alpha (`binance-spot`, `coinbase-spot`,
 * `defillama-protocols`, `rss-*`, `github-*`). Unknown ids pass through:
 * custom connectors (e.g. test fakes with bespoke shapes) keep working.
 */

import type { RawCapture } from "./connectors.js";

/** Returns an error message when the payload is malformed, else undefined. */
export type PayloadValidator = (payload: unknown) => string | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOfObjects(
  payload: unknown,
):
  | { readonly ok: true; readonly rows: Record<string, unknown>[] }
  | { readonly ok: false; readonly error: string } {
  if (!Array.isArray(payload)) {
    return { ok: false, error: "payload is not a JSON array" };
  }
  for (const row of payload) {
    if (!isPlainObject(row)) {
      return { ok: false, error: "payload row is not an object" };
    }
  }
  return { ok: true, rows: payload as Record<string, unknown>[] };
}

function requireStringFields(
  rows: readonly Record<string, unknown>[],
  fields: readonly string[],
): string | undefined {
  for (const row of rows) {
    for (const field of fields) {
      if (typeof row[field] !== "string") {
        return `payload row is missing string field "${field}"`;
      }
    }
  }
  return undefined;
}

/** Binance 24h ticker rows: the fields normalization and mover screening read. */
export const validateBinancePayload: PayloadValidator = (payload) => {
  const rows = arrayOfObjects(payload);
  if (!rows.ok) {
    return rows.error;
  }
  return requireStringFields(rows.rows, [
    "symbol",
    "lastPrice",
    "priceChangePercent",
    "quoteVolume",
  ]);
};

/** Coinbase product rows: normalization splits the product `id` on "-". */
export const validateCoinbasePayload: PayloadValidator = (payload) => {
  const rows = arrayOfObjects(payload);
  if (!rows.ok) {
    return rows.error;
  }
  return requireStringFields(rows.rows, ["id"]);
};

/** DefiLlama protocol rows: normalization ranks by `name` and TVL. */
export const validateDefiLlamaPayload: PayloadValidator = (payload) => {
  const rows = arrayOfObjects(payload);
  if (!rows.ok) {
    return rows.error;
  }
  return requireStringFields(rows.rows, ["name"]);
};

/** RSS/Atom feeds: the capture is the raw XML body text. */
export const validateFeedPayload: PayloadValidator = (payload) => {
  if (typeof payload !== "string") {
    return "payload is not body text";
  }
  if (payload.trim().length === 0) {
    return "payload is empty";
  }
  return undefined;
};

/** GitHub releases/latest: an object with a release `tag_name`. */
export const validateGitHubPayload: PayloadValidator = (payload) => {
  if (!isPlainObject(payload)) {
    return "payload is not a JSON object";
  }
  if (typeof payload.tag_name !== "string") {
    return 'payload is missing string field "tag_name"';
  }
  return undefined;
};

/** Validate a successful capture's payload by connector id; undefined when valid. */
export function validateCapturePayload(capture: RawCapture): string | undefined {
  switch (capture.connectorId) {
    case "binance-spot":
      return validateBinancePayload(capture.payload);
    case "coinbase-spot":
      return validateCoinbasePayload(capture.payload);
    case "defillama-protocols":
      return validateDefiLlamaPayload(capture.payload);
    default:
      break;
  }
  if (capture.connectorId.startsWith("rss-")) {
    return validateFeedPayload(capture.payload);
  }
  if (capture.connectorId.startsWith("github-")) {
    return validateGitHubPayload(capture.payload);
  }
  return undefined;
}

/**
 * Enforce payload validity on a capture before persistence: a successful
 * capture with a malformed HTTP-200 payload becomes a recorded failure —
 * connector id, URL, status, and timestamp preserved, payload omitted,
 * error marked `invalid payload`. Failed captures pass through untouched.
 */
export function enforcePayloadValidity(capture: RawCapture): RawCapture {
  if (!capture.ok) {
    return capture;
  }
  const problem = validateCapturePayload(capture);
  if (problem === undefined) {
    return capture;
  }
  return {
    connectorId: capture.connectorId,
    url: capture.url,
    ok: false,
    ...(capture.status === undefined ? {} : { status: capture.status }),
    fetchedAt: capture.fetchedAt,
    error: `invalid payload: ${problem}`,
  };
}
