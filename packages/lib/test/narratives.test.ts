import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyGrouping,
  GROUPING_RULES_VERSION,
  GROUPING_SCHEMA_VERSION,
  GroupingError,
  type GroupingRecord,
  readNarratives,
} from "../src/index.js";

function record(
  runId: string,
  groups: GroupingRecord["groups"],
  overrides: Partial<GroupingRecord> = {},
): GroupingRecord {
  return {
    schemaVersion: GROUPING_SCHEMA_VERSION,
    runId,
    groupedAt: "2026-08-27T12:30:00.000Z",
    model: "test-agent",
    rulesVersion: GROUPING_RULES_VERSION,
    groups,
    ...overrides,
  };
}

function group(groupId: string, docId: string, narrativeId?: string) {
  return {
    groupId,
    title: `Event ${groupId}`,
    rationale: `Rationale for ${groupId}.`,
    docIds: [docId],
    ...(narrativeId !== undefined ? { narrativeId } : {}),
  };
}

function freshStore(): string {
  return mkdtempSync(join(tmpdir(), "resonance-narratives-"));
}

describe("applyGrouping", () => {
  it("allocates narrative identities in order", () => {
    const store = freshStore();
    const result = applyGrouping(
      store,
      record("run-1", [
        group("g000", "aaaaaaaaaaaa"),
        { ...group("g001", "bbbbbbbbbbbb"), theme: "Stablecoin payments" },
      ]),
    );
    expect(result.allocated).toEqual(["n0001", "n0002"]);
    expect(result.matched).toEqual([]);
    const narratives = readNarratives(store);
    expect(narratives[0]?.title).toBe("Event g000");
    expect(narratives[0]?.theme).toBe("Event g000");
    expect(narratives[1]?.theme).toBe("Stablecoin payments");
    expect(narratives[0]?.establishedRunId).toBe("run-1");
  });

  it("refreshes matched narratives and continues allocation", () => {
    const store = freshStore();
    applyGrouping(store, record("run-1", [group("g000", "aaaaaaaaaaaa")]));
    const result = applyGrouping(
      store,
      record("run-2", [group("g000", "cccccccccccc", "n0001"), group("g001", "dddddddddddd")]),
    );
    expect(result.matched).toEqual(["n0001"]);
    expect(result.allocated).toEqual(["n0002"]);
    const narratives = readNarratives(store);
    expect(narratives[0]?.lastSeenRunId).toBe("run-2");
    expect(narratives[0]?.establishedRunId).toBe("run-1");
  });

  it("rejects matches against unknown narratives", () => {
    const store = freshStore();
    try {
      applyGrouping(store, record("run-1", [group("g000", "aaaaaaaaaaaa", "n9999")]));
    } catch (error) {
      expect(error).toBeInstanceOf(GroupingError);
      expect((error as GroupingError).code).toBe("invalid-narrative-id");
      return;
    }
    expect.fail("expected GroupingError");
  });

  it("writes nothing for a grouping without groups", () => {
    const store = freshStore();
    const result = applyGrouping(store, record("run-1", []));
    expect(result).toEqual({ allocated: [], matched: [] });
    expect(readNarratives(store)).toEqual([]);
  });

  it("returns an empty ledger for a fresh store", () => {
    expect(readNarratives(freshStore())).toEqual([]);
  });
});
