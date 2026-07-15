import { describe, expect, test } from "bun:test";
import {
  ROADMAP_EDGES,
  roadmapRoots,
  roadmapRows,
  roadmapPatterns,
  roadmapLevels,
  roadmapLevelOf,
  roadmapMove,
} from "./roadmap.ts";
import { NEETCODE_PATTERNS } from "./tags.ts";

describe("roadmap graph integrity", () => {
  test("every pattern in the graph is a real NeetCode pattern", () => {
    const set = new Set<string>(NEETCODE_PATTERNS);
    for (const p of roadmapPatterns()) expect(set.has(p)).toBe(true);
  });

  test("covers all 18 NeetCode patterns", () => {
    expect(new Set(roadmapPatterns()).size).toBe(18);
    for (const p of NEETCODE_PATTERNS) expect(roadmapPatterns()).toContain(p);
  });

  test("every child edge points at a declared pattern", () => {
    const declared = new Set(roadmapPatterns());
    for (const [, children] of ROADMAP_EDGES) {
      for (const c of children) expect(declared.has(c)).toBe(true);
    }
  });

  test("Arrays & Hashing is the sole root", () => {
    expect(roadmapRoots()).toEqual(["Arrays & Hashing"]);
  });
});

describe("roadmapRows", () => {
  const rows = roadmapRows();

  test("first row is the root at depth 0", () => {
    expect(rows[0]).toEqual({ pattern: "Arrays & Hashing", depth: 0, repeat: false });
  });

  test("every pattern is expanded exactly once (non-repeat)", () => {
    const expandedOnce = rows.filter((r) => !r.repeat).map((r) => r.pattern);
    expect(new Set(expandedOnce).size).toBe(expandedOnce.length); // no dupes
    expect(new Set(expandedOnce).size).toBe(18); // all patterns expanded
  });

  test("a shared-prerequisite pattern appears as a repeat leaf too", () => {
    // 2-D DP is a child of both Graphs and 1-D DP → one expand + one repeat.
    const twoD = rows.filter((r) => r.pattern === "2-D Dynamic Programming");
    expect(twoD.length).toBeGreaterThanOrEqual(2);
    expect(twoD.some((r) => !r.repeat)).toBe(true);
    expect(twoD.some((r) => r.repeat)).toBe(true);
  });

  test("children are deeper than their parent", () => {
    // Two Pointers (child of root) sits at depth 1.
    const tp = rows.find((r) => r.pattern === "Two Pointers" && !r.repeat)!;
    expect(tp.depth).toBe(1);
  });
});

describe("box layout (levels)", () => {
  test("the root is the only pattern on level 0", () => {
    expect(roadmapLevels()[0]).toEqual(["Arrays & Hashing"]);
  });

  test("every pattern appears in exactly one level", () => {
    const flat = roadmapLevels().flat();
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat)).toEqual(new Set(roadmapPatterns()));
  });

  test("every edge points strictly downward (child level > parent level)", () => {
    const level = roadmapLevelOf();
    for (const [parent, children] of ROADMAP_EDGES) {
      for (const c of children) {
        expect(level.get(c)!).toBeGreaterThan(level.get(parent)!);
      }
    }
  });

  test("a multi-parent node sits below its deepest parent (longest path)", () => {
    const level = roadmapLevelOf();
    // 2-D DP follows Graphs and 1-D DP; its level is 1 + the deeper of the two.
    const twoD = level.get("2-D Dynamic Programming")!;
    expect(twoD).toBeGreaterThan(level.get("Graphs")!);
    expect(twoD).toBeGreaterThan(level.get("1-D Dynamic Programming")!);
  });
});

describe("roadmapMove", () => {
  const flat = roadmapPatterns();
  const idx = (p: string) => flat.indexOf(p);

  test("down from the root lands on the first box of level 1", () => {
    expect(roadmapMove(idx("Arrays & Hashing"), "down")).toBe(idx("Two Pointers"));
  });
  test("right moves within a level", () => {
    expect(roadmapMove(idx("Two Pointers"), "right")).toBe(idx("Stack"));
  });
  test("left at the start of a row stays put", () => {
    expect(roadmapMove(idx("Two Pointers"), "left")).toBe(idx("Two Pointers"));
  });
  test("up from level 1 returns toward the root", () => {
    expect(roadmapMove(idx("Stack"), "up")).toBe(idx("Arrays & Hashing"));
  });
  test("down from the last level stays put", () => {
    expect(roadmapMove(idx("Math & Geometry"), "down")).toBe(idx("Math & Geometry"));
  });
});
