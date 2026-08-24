import { describe, expect, it } from "vitest";
import {
  contentHashOf,
  dedupeDocuments,
  docIdOf,
  EVIDENCE_REF_PATTERN,
  EXIT_DEGRADED,
  EXIT_ERROR,
  EXIT_OK,
  formatEvidenceRef,
  makeDocument,
  SCAN_LIFECYCLE,
  SNAPSHOT_SCHEMA_VERSION,
  sourceCountsOf,
} from "../src/index.js";

const CAPTURED_AT = "2026-08-24T00:00:00Z";

describe("scan lifecycle contract", () => {
  it("locks the five stages in execution order", () => {
    expect(SCAN_LIFECYCLE).toEqual(["fetch", "normalize", "cluster", "evidence", "candidates"]);
  });
});

describe("exit code contract", () => {
  it("locks the three exit codes", () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_ERROR).toBe(1);
    expect(EXIT_DEGRADED).toBe(2);
  });
});

describe("document identity contract", () => {
  const input = {
    sourceId: "binance-spot",
    kind: "market" as const,
    url: "https://example.invalid/fixtures/smoke",
    title: "Smoke fixture",
    text: "Fixture document for the smoke test.",
  };

  it("derives deterministic content hashes and docIds", () => {
    const hash = contentHashOf(input);
    expect(hash).toBe("54e2d38ecbdbcbd2c6b9a4a320ce483f6976278209215a53e012c1091facc134");
    expect(docIdOf(hash)).toBe("54e2d38ecbdb");
  });

  it("changes the hash when any identity field changes", () => {
    const base = contentHashOf(input);
    expect(contentHashOf({ ...input, title: "Different" })).not.toBe(base);
    expect(contentHashOf({ ...input, url: "https://example.invalid/other" })).not.toBe(base);
    expect(contentHashOf({ ...input, sourceId: "coinbase-spot" })).not.toBe(base);
  });

  it("makeDocument fills identity fields from inputs", () => {
    const doc = makeDocument(input, CAPTURED_AT, { asset: "BTC" });
    expect(doc.docId).toBe("54e2d38ecbdb");
    expect(doc.contentHash).toBe(contentHashOf(input));
    expect(doc.contentHash).toHaveLength(64);
    expect(doc.capturedAt).toBe(CAPTURED_AT);
    expect(doc.asset).toBe("BTC");
  });
});

describe("deduplication contract", () => {
  const docA = makeDocument(
    {
      sourceId: "hyperliquid-perps",
      kind: "positioning" as const,
      url: "https://app.hyperliquid.xyz/trade/HYPE",
      title: "HYPE positioning",
      text: "Open interest and funding for HYPE.",
    },
    CAPTURED_AT,
  );
  const docB = makeDocument(
    {
      sourceId: "hyperliquid-perps",
      kind: "positioning" as const,
      url: "https://app.hyperliquid.xyz/trade/BTC",
      title: "BTC positioning",
      text: "Open interest and funding for BTC.",
    },
    CAPTURED_AT,
  );

  it("drops exact content duplicates", () => {
    expect(dedupeDocuments([docA, docA, docB])).toEqual([docA, docB]);
  });

  it("keeps the first write on a shared (sourceId, url) collision", () => {
    const sameUrlDifferentContent = { ...docB, url: docA.url };
    expect(dedupeDocuments([docA, sameUrlDifferentContent])).toEqual([docA]);
    expect(dedupeDocuments([sameUrlDifferentContent, docA])).toEqual([sameUrlDifferentContent]);
  });

  it("allows the same URL under different sources", () => {
    const otherSource = makeDocument(
      {
        sourceId: "mirror",
        kind: "positioning" as const,
        url: docA.url,
        title: "HYPE positioning",
        text: "Open interest and funding for HYPE.",
      },
      CAPTURED_AT,
    );
    expect(dedupeDocuments([docA, otherSource])).toEqual([docA, otherSource]);
  });
});

describe("evidence reference contract", () => {
  it("formats docIds as bracketed 12-hex references", () => {
    expect(formatEvidenceRef("54e2d38ecbdb")).toBe("[54e2d38ecbdb]");
  });

  it("matches only locked-format references", () => {
    const text = "See [54e2d38ecbdb] and [abc] and [54e2d38ecbdbaa] and [54e2d38ecbdb].";
    expect(text.match(EVIDENCE_REF_PATTERN)).toEqual(["[54e2d38ecbdb]", "[54e2d38ecbdb]"]);
  });

  it("counts documents per source", () => {
    const docs = [
      makeDocument(
        {
          sourceId: "feeds",
          kind: "news" as const,
          url: "https://example.invalid/a",
          title: "A",
          text: "a",
        },
        CAPTURED_AT,
      ),
      makeDocument(
        {
          sourceId: "feeds",
          kind: "news" as const,
          url: "https://example.invalid/b",
          title: "B",
          text: "b",
        },
        CAPTURED_AT,
      ),
      makeDocument(
        {
          sourceId: "binance-full-tape",
          kind: "mover" as const,
          url: "https://example.invalid/c",
          title: "C",
          text: "c",
        },
        CAPTURED_AT,
      ),
    ];
    expect(sourceCountsOf(docs)).toEqual({ feeds: 2, "binance-full-tape": 1 });
  });
});

describe("snapshot schema version", () => {
  it("is locked at 0.1", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe("0.1");
  });
});
