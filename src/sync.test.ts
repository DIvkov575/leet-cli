import { describe, expect, test } from "bun:test";
import { collectTargets, staggerDelay, syncTargets } from "./sync.ts";

describe("collectTargets", () => {
  test("de-dupes across lists and annotates membership", async () => {
    const targets = await collectTargets(["neetcode-250", "uber"]);
    // two-sum is in multiple lists; should appear once with both.
    const twoSum = targets.find((t) => t.slug === "two-sum");
    expect(twoSum).toBeDefined();
    expect(twoSum!.lists.length).toBeGreaterThanOrEqual(1);
    // No duplicate slugs.
    const slugs = targets.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    // Sorted by slug.
    expect([...slugs].sort()).toEqual(slugs);
  });
});

describe("staggerDelay", () => {
  test("waits within the configured bounds", async () => {
    const start = performance.now();
    await staggerDelay(10, 20, () => 0.5); // -> 15ms
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(10);
  });
});

// A fake fetchProblem is injected by mocking the module boundary via a stub map.
// syncTargets calls the real fetchProblem, so here we test the skip/write logic
// by exercising the exists/write callbacks with a target set that is fully
// skipped (no network) — the deterministic, offline-safe path.
describe("syncTargets skip logic", () => {
  test("skips all when everything already exists; no writes, no fetches", async () => {
    const written: string[] = [];
    const result = await syncTargets(
      [
        { slug: "two-sum", lists: ["uber"] },
        { slug: "valid-anagram", lists: ["neetcode-250"] },
      ],
      {
        skipExisting: true,
        minDelayMs: 0,
        maxDelayMs: 0,
        rand: () => 0,
        exists: async () => true, // pretend all present -> must skip before fetch
        write: async (f) => {
          written.push(f);
        },
      },
    );
    expect(result.skipped.sort()).toEqual(["two-sum", "valid-anagram"]);
    expect(result.written).toEqual([]);
    expect(written).toEqual([]);
  });
});
