import { describe, expect, it } from "vitest";
import {
  type AssetMove,
  type Briefing,
  buildBriefing,
  type Narrative,
  type NarrativeObservation,
  type PartialScore,
  renderBriefing,
  scoreAll,
} from "../src/index.js";

const RUN = "2026-08-28T13-48-29";

const MOVERS: AssetMove[] = [
  { asset: "HEMI", changePercent: 36.67 },
  { asset: "TUT", changePercent: -29.93 },
  { asset: "TRUMP", changePercent: 16.22 },
  { asset: "ENA", changePercent: 12.08 },
];

function observation(
  narrativeId: string,
  assetsMentioned: readonly string[],
  overrides: Partial<NarrativeObservation> = {},
): NarrativeObservation {
  return {
    runId: RUN,
    scannedAt: "2026-08-28T13:48:29.000Z",
    narrativeId,
    documents: 4,
    sources: 3,
    assetsMentioned,
    marketAssets: ["ENA", "HEMI", "TRUMP", "TUT"],
    movers: MOVERS,
    corpusDocuments: 240,
    ...overrides,
  };
}

function narrative(narrativeId: string, title: string): Narrative {
  return { narrativeId, title, theme: title, establishedRunId: RUN, lastSeenRunId: RUN };
}

function brief(observations: readonly NarrativeObservation[]): Briefing {
  return buildBriefing({
    runId: RUN,
    narratives: observations.map((o) => narrative(o.narrativeId, `Narrative ${o.narrativeId}`)),
    observations,
    scores: scoreAll(observations),
  });
}

describe("buildBriefing", () => {
  it("reports movers no narrative mentions, strongest first", () => {
    const built = brief([observation("n0001", ["ENA"])]);
    // ENA is covered by the narrative; the rest are not.
    expect(built.uncovered.map((m) => m.asset)).toEqual(["HEMI", "TUT", "TRUMP"]);
  });

  it("ranks a narrative as confirmed when it names a mover", () => {
    const built = brief([observation("n0001", ["ENA"]), observation("n0002", ["HEMI"])]);
    expect(built.confirmed.map((c) => c.narrativeId).sort()).toEqual(["n0001", "n0002"]);
    expect(built.uncovered.map((m) => m.asset)).toEqual(["TUT", "TRUMP"]);
  });

  it("separates scored narratives that name no mover from unscored ones", () => {
    const built = brief([
      observation("n0001", ["ENA"]),
      // Mentions a tradeable asset that did not move: scored, but quiet.
      observation("n0002", ["BTC"], { marketAssets: ["BTC", "ENA"] }),
      // Mentions nothing tradeable: honestly unscored, never a fabricated zero.
      observation("n0003", []),
    ]);
    expect(built.confirmed.map((c) => c.narrativeId)).toEqual(["n0001"]);
    expect(built.quiet.map((c) => c.narrativeId)).toEqual(["n0002"]);
    expect(built.unscored).toBe(1);
  });

  it("attaches the confirming moves to the narrative", () => {
    const built = brief([observation("n0001", ["ENA", "TRUMP"])]);
    expect(built.confirmed[0]?.confirming).toEqual([
      { asset: "TRUMP", changePercent: 16.22 },
      { asset: "ENA", changePercent: 12.08 },
    ]);
  });

  it("compares assets and movers case-insensitively", () => {
    // Observations written under mention rules 1 hold lowercase names.
    const built = brief([observation("n0001", ["ena"])]);
    expect(built.confirmed[0]?.confirming.map((m) => m.asset)).toEqual(["ENA"]);
  });

  it("honours the mover limit", () => {
    const built = buildBriefing({
      runId: RUN,
      narratives: [narrative("n0001", "One")],
      observations: [observation("n0001", [])],
      scores: new Map<string, PartialScore>(),
      moverLimit: 2,
    });
    expect(built.uncovered).toHaveLength(2);
  });

  it("states what the run cannot measure", () => {
    const built = brief([observation("n0001", ["ENA"])]);
    expect(built.limits.join(" ")).toContain("cold-start");
  });

  it("ignores observations from other runs", () => {
    const other = observation("n0002", ["HEMI"], { runId: "2026-08-01T00-00-00" });
    const built = brief([observation("n0001", ["ENA"]), other]);
    expect(built.confirmed.map((c) => c.narrativeId)).toEqual(["n0001"]);
  });
});

describe("renderBriefing", () => {
  it("leads with off-radar movers, then confirmed narratives", () => {
    const text = renderBriefing(brief([observation("n0001", ["ENA"])]));
    expect(text.indexOf("OFF-RADAR MOVERS")).toBeLessThan(text.indexOf("CONFIRMED NARRATIVES"));
    expect(text).toContain("HEMI");
    expect(text).toContain("+36.67%");
    expect(text).toContain("ENA +12.08%");
  });

  it("says so plainly when nothing is uncovered or confirmed", () => {
    const built = buildBriefing({
      runId: RUN,
      narratives: [],
      observations: [observation("n0001", [], { movers: [] })],
      scores: new Map<string, PartialScore>(),
    });
    const text = renderBriefing(built);
    expect(text).toContain("none: every screened mover");
    expect(text).toContain("none: no narrative this run names a screened mover");
    expect(text).toContain("no movers were screened this run");
  });
});
