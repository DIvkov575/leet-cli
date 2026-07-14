import { describe, expect, test } from "bun:test";
import { derivePatternFromTopics, resolveTags, NEETCODE_PATTERNS } from "./tags.ts";

describe("derivePatternFromTopics", () => {
  test("specific topic beats generic ones (sliding-window over array)", () => {
    expect(derivePatternFromTopics(["array", "sliding-window", "hash-table"])).toBe("Sliding Window");
  });
  test("tree topics map to Trees", () => {
    expect(derivePatternFromTopics(["binary-tree", "depth-first-search"])).toBe("Trees");
  });
  test("falls back to Arrays & Hashing for a plain array problem", () => {
    expect(derivePatternFromTopics(["array"])).toBe("Arrays & Hashing");
  });
  test("null when no known topic present", () => {
    expect(derivePatternFromTopics(["database"])).toBeNull();
  });
  test("every mapped pattern is a real NeetCode pattern", () => {
    const p = derivePatternFromTopics(["dynamic-programming"]);
    expect(NEETCODE_PATTERNS).toContain(p as any);
  });
});

describe("resolveTags", () => {
  test("native NeetCode pattern is authoritative and marked 'neetcode'", () => {
    const r = resolveTags("Two Pointers", ["array", "two-pointers"]);
    expect(r.pattern).toBe("Two Pointers");
    expect(r.patternSource).toBe("neetcode");
    expect(r.topics).toEqual(["array", "two-pointers"]);
  });
  test("absent NeetCode pattern is inferred and marked 'derived'", () => {
    const r = resolveTags(null, ["array", "binary-search"]);
    expect(r.pattern).toBe("Binary Search");
    expect(r.patternSource).toBe("derived");
  });
  test("no pattern at all when topics are unknown (e.g. SQL)", () => {
    const r = resolveTags(undefined, ["database"]);
    expect(r.pattern).toBeUndefined();
    expect(r.patternSource).toBeUndefined();
    expect(r.topics).toEqual(["database"]);
  });
});
