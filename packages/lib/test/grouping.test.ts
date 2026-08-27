import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GROUPING_RULES_VERSION,
  GROUPING_SCHEMA_VERSION,
  GroupingError,
  type GroupingRecord,
  groupingPath,
  makeDocument,
  preGroupHints,
  readGrouping,
  validateGrouping,
  writeGrouping,
} from "../src/index.js";

function record(overrides: Partial<GroupingRecord> = {}): GroupingRecord {
  return {
    schemaVersion: GROUPING_SCHEMA_VERSION,
    runId: "2026-08-27T12-00-00",
    groupedAt: "2026-08-27T12:30:00.000Z",
    model: "test-agent",
    rulesVersion: GROUPING_RULES_VERSION,
    groups: [
      {
        groupId: "g000",
        title: "Solana slot time cut",
        rationale: "Two outlets report the same 350ms slot-time change.",
        docIds: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"],
      },
    ],
    ...overrides,
  };
}

function freshRun(): string {
  return mkdtempSync(join(tmpdir(), "resonance-run-"));
}

function expectGroupingError(fn: () => unknown, code: GroupingError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GroupingError);
    expect((error as GroupingError).code).toBe(code);
    return;
  }
  expect.fail(`expected GroupingError with code "${code}"`);
}

describe("validateGrouping", () => {
  it("accepts a well-formed record", () => {
    expect(() => validateGrouping(record())).not.toThrow();
  });

  it("rejects malformed or duplicate group ids", () => {
    expectGroupingError(
      () => validateGrouping(record({ groups: [{ ...record().groups[0]!, groupId: "x1" }] })),
      "invalid-group-id",
    );
    expectGroupingError(
      () =>
        validateGrouping(
          record({
            groups: [record().groups[0]!, { ...record().groups[0]!, docIds: ["cccccccccccc"] }],
          }),
        ),
      "duplicate-group-id",
    );
  });

  it("rejects empty rationale and empty groups", () => {
    expectGroupingError(
      () => validateGrouping(record({ groups: [{ ...record().groups[0]!, rationale: "  " }] })),
      "empty-rationale",
    );
    expectGroupingError(
      () => validateGrouping(record({ groups: [{ ...record().groups[0]!, docIds: [] }] })),
      "empty-group",
    );
  });

  it("enforces one-event membership per document", () => {
    const base = record().groups[0]!;
    expectGroupingError(
      () =>
        validateGrouping(
          record({
            groups: [base, { ...base, groupId: "g001", docIds: ["aaaaaaaaaaaa"] }],
          }),
        ),
      "duplicate-document",
    );
  });

  it("validates doc ids and narrative ids", () => {
    expectGroupingError(
      () => validateGrouping(record({ groups: [{ ...record().groups[0]!, docIds: ["XYZ"] }] })),
      "invalid-doc-id",
    );
    expectGroupingError(
      () =>
        validateGrouping(
          record({ groups: [{ ...record().groups[0]!, narrativeId: "not-a-narrative" }] }),
        ),
      "invalid-narrative-id",
    );
  });
});

describe("writeGrouping", () => {
  it("persists and reads back, refusing rewrites", () => {
    const runDir = freshRun();
    writeGrouping(runDir, record());
    expect(readGrouping(runDir)?.groups[0]?.title).toBe("Solana slot time cut");
    expectGroupingError(() => writeGrouping(runDir, record()), "grouping-exists");
  });

  it("serializes deterministically", () => {
    const runA = freshRun();
    const runB = freshRun();
    writeGrouping(runA, record());
    writeGrouping(runB, record());
    expect(readFileSync(groupingPath(runA), "utf8")).toBe(readFileSync(groupingPath(runB), "utf8"));
  });

  it("returns null for a run without grouping", () => {
    expect(readGrouping(freshRun())).toBeNull();
  });
});

describe("preGroupHints", () => {
  function doc(sourceId: string, title: string, text: string) {
    return makeDocument(
      {
        sourceId,
        kind: "news",
        url: `https://example.invalid/${sourceId}/${title.length}`,
        title,
        text,
      },
      "2026-08-27T00:00:00.000Z",
    );
  }

  it("surfaces multi-document lexical candidates with titles and terms", () => {
    const hints = preGroupHints([
      doc("rss-a", "Solana cuts slot time to 350 milliseconds", "validator upgrade"),
      doc("rss-b", "Solana cuts mainnet slot time to 350 milliseconds", "validator upgrade"),
      doc("rss-c", "Unrelated governance vote passes", "totally different vocabulary"),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.docIds).toHaveLength(2);
    expect(hints[0]?.titles[0]).toContain("Solana");
    expect(hints[0]?.topTerms.length).toBeGreaterThan(0);
  });

  it("returns no hints for a corpus without lexical overlap", () => {
    const hints = preGroupHints([
      doc("rss-a", "Alpha beta gamma", "delta epsilon"),
      doc("rss-b", "Zeta eta theta", "iota kappa"),
    ]);
    expect(hints).toEqual([]);
  });
});
