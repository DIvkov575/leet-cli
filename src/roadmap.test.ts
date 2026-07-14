import { describe, expect, test } from "bun:test";
import {
  ROADMAP_EDGES,
  roadmapRoots,
  roadmapRows,
  roadmapPatterns,
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
