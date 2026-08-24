/**
 * Raw-capture persistence.
 *
 * The snapshot layer persists what connectors fetch: one JSON file per
 * connector per run at `<runDir>/raw/<connectorId>.json`. Captures are
 * immutable (rewrites refused) and serialized deterministically so git
 * diffs stay minimal. Interpretation of payloads is out of scope here.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RawCapture } from "./connectors.js";
import { canonicalJsonString } from "./snapshot-store.js";

/** Failure codes for capture persistence operations. */
export type CaptureStoreErrorCode = "invalid-connector-id" | "capture-exists";

/** Error thrown by capture persistence, with a stable `code`. */
export class CaptureStoreError extends Error {
  readonly code: CaptureStoreErrorCode;

  constructor(code: CaptureStoreErrorCode, message: string) {
    super(message);
    this.name = "CaptureStoreError";
    this.code = code;
  }
}

/** ConnectorIds double as file stems; this keeps them traversal-safe. */
const CONNECTOR_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;

/** Subdirectory of a run directory holding raw captures. */
export const RAW_DIR = "raw";

function assertConnectorId(connectorId: string): void {
  if (!CONNECTOR_ID_PATTERN.test(connectorId)) {
    throw new CaptureStoreError(
      "invalid-connector-id",
      `connectorId must match ${CONNECTOR_ID_PATTERN} (got "${connectorId}")`,
    );
  }
}

/** Path of a connector's capture file inside a run directory. */
export function capturePath(runDir: string, connectorId: string): string {
  assertConnectorId(connectorId);
  return join(runDir, RAW_DIR, `${connectorId}.json`);
}

/**
 * Persist a raw capture. Refuses to overwrite an existing capture for the
 * same connector in the same run; failures (ok=false) are persisted too,
 * without a payload.
 */
export function writeCapture(runDir: string, capture: RawCapture): string {
  const path = capturePath(runDir, capture.connectorId);
  if (existsSync(path)) {
    throw new CaptureStoreError(
      "capture-exists",
      `capture ${capture.connectorId} already exists in ${runDir} and is immutable`,
    );
  }
  mkdirSync(join(runDir, RAW_DIR), { recursive: true });
  writeFileSync(path, canonicalJsonString(capture), "utf8");
  return path;
}

/** Read a persisted capture back; `null` when absent. */
export function readCapture(runDir: string, connectorId: string): RawCapture | null {
  const path = capturePath(runDir, connectorId);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as RawCapture;
}
