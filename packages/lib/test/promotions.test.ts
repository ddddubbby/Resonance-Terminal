import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GROUPING_RULES_VERSION,
  GROUPING_SCHEMA_VERSION,
  type GroupingRecord,
} from "../src/grouping.js";
import { applyGrouping } from "../src/narratives.js";
import { type PromotionError, promoteNarrative, readPromotions } from "../src/promotions.js";

const tmpDirs: string[] = [];
function freshStore(): string {
  const dir = mkdtempSync(join(tmpdir(), "resonance-promotions-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedNarrative(store: string): void {
  const record: GroupingRecord = {
    schemaVersion: GROUPING_SCHEMA_VERSION,
    runId: "run-1",
    groupedAt: "2026-08-27T12:30:00.000Z",
    model: "test-agent",
    rulesVersion: GROUPING_RULES_VERSION,
    groups: [
      {
        groupId: "g001",
        title: "Stablecoin payments",
        rationale: "Same event across two feeds.",
        docIds: ["aaaaaaaaaaaa"],
      },
    ],
  };
  applyGrouping(store, record);
}

describe("promoteNarrative", () => {
  it("promotes an existing narrative with note and run", () => {
    const store = freshStore();
    seedNarrative(store);
    const promotion = promoteNarrative(store, {
      narrativeId: "n0001",
      promotedAt: "2026-08-27T13:00:00.000Z",
      runId: "run-1",
      note: "breadth and momentum align",
    });
    expect(promotion.narrativeId).toBe("n0001");
    expect(readPromotions(store)).toEqual([promotion]);
  });

  it("returns an empty ledger for a fresh store", () => {
    expect(readPromotions(freshStore())).toEqual([]);
  });

  it("rejects malformed narrative ids", () => {
    const store = freshStore();
    seedNarrative(store);
    try {
      promoteNarrative(store, { narrativeId: "x0001" });
    } catch (error) {
      expect((error as PromotionError).code).toBe("invalid-narrative-id");
      return;
    }
    expect.fail("expected PromotionError");
  });

  it("rejects unknown narratives", () => {
    const store = freshStore();
    try {
      promoteNarrative(store, { narrativeId: "n0001" });
    } catch (error) {
      expect((error as PromotionError).code).toBe("unknown-narrative");
      return;
    }
    expect.fail("expected PromotionError");
  });

  it("promotes each narrative at most once", () => {
    const store = freshStore();
    seedNarrative(store);
    promoteNarrative(store, { narrativeId: "n0001", promotedAt: "2026-08-27T13:00:00.000Z" });
    try {
      promoteNarrative(store, { narrativeId: "n0001", promotedAt: "2026-08-27T14:00:00.000Z" });
    } catch (error) {
      expect((error as PromotionError).code).toBe("duplicate-promotion");
      return;
    }
    expect.fail("expected PromotionError");
  });
});
