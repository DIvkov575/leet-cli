import { describe, expect, test } from "bun:test";
import { collectTargets, staggerDelay, syncTargets, missingManifest } from "./sync.ts";
import type { LiveProblem } from "./leetcode.ts";

// Build a LiveProblem stand-in for the injected fetch.
function live(over: Partial<LiveProblem> & { slug: string }): LiveProblem {
  return {
    id: 1,
    title: "T",
    slug: over.slug,
    difficulty: "Easy",
    acceptance: 50,
    isPaidOnly: false,
    category: "Algorithms",
    snippets: [],
    metaData: undefined,
    exampleTestcases: undefined,
    contentHtml: "<p>desc</p>",
    ...over,
  };
}

const cppSnip = [{ lang: "C++", langSlug: "cpp", code: "class Solution {\npublic:\n};" }];

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

describe("syncTargets classification & fallback", () => {
  const baseOpts = {
    skipExisting: false,
    minDelayMs: 0,
    maxDelayMs: 0,
    rand: () => 0,
    neetcodeFallback: false as boolean,
  };

  test("writes normally when a C++ starter exists", async () => {
    const files: string[] = [];
    const r = await syncTargets([{ slug: "two-sum", lists: ["uber"] }], {
      ...baseOpts,
      fetchProblem: async () => live({ slug: "two-sum", snippets: cppSnip }),
      write: async (f) => void files.push(f),
    });
    expect(r.written).toEqual(["two-sum"]);
    expect(r.missed).toEqual([]);
    expect(files.some((f) => f.endsWith("1-two-sum.cpp"))).toBe(true);
  });

  test("classifies premium, sql, and javascript misses", async () => {
    const byslug: Record<string, LiveProblem> = {
      "meeting-rooms": live({ slug: "meeting-rooms", isPaidOnly: true }),
      "combine-two-tables": live({ slug: "combine-two-tables", category: "Database" }),
      "hello-fn": live({ slug: "hello-fn", snippets: [{ lang: "JS", langSlug: "javascript", code: "" }] }),
    };
    const r = await syncTargets(
      Object.keys(byslug).map((slug) => ({ slug, lists: ["x"] })),
      {
        ...baseOpts,
        fetchProblem: async (slug) => byslug[slug]!,
        write: async () => {},
      },
    );
    const reasons = Object.fromEntries(r.missed.map((m) => [m.slug, m.reason]));
    expect(reasons["meeting-rooms"]).toBe("premium");
    expect(reasons["combine-two-tables"]).toBe("sql");
    expect(reasons["hello-fn"]).toBe("javascript");
  });

  test("recovers a premium problem from the NeetCode fallback", async () => {
    const files: Record<string, string> = {};
    const r = await syncTargets([{ slug: "meeting-rooms", lists: ["citadel"] }], {
      ...baseOpts,
      neetcodeFallback: true,
      fetchProblem: async () => live({ slug: "meeting-rooms", isPaidOnly: true }),
      fetchNeetcode: async () => ({ code: "class Solution { /* nc */ };", sourceUrl: "https://nc/x.cpp" }),
      write: async (f, c) => void (files[f] = c),
    });
    expect(r.recovered).toEqual(["meeting-rooms"]);
    expect(r.missed).toEqual([]);
    const cpp = files["1-meeting-rooms.cpp"]!;
    expect(cpp).toContain("Solution");
    expect(cpp).toContain("NeetCode"); // provenance header
  });

  test("does not consult NeetCode for SQL problems", async () => {
    let ncCalls = 0;
    const r = await syncTargets([{ slug: "combine-two-tables", lists: ["x"] }], {
      ...baseOpts,
      neetcodeFallback: true,
      fetchProblem: async () => live({ slug: "combine-two-tables", category: "Database" }),
      fetchNeetcode: async () => {
        ncCalls++;
        return null;
      },
      write: async () => {},
    });
    expect(ncCalls).toBe(0);
    expect(r.missed[0]!.reason).toBe("sql");
  });

  test("falls back to a placeholder when NeetCode also has nothing", async () => {
    const files: Record<string, string> = {};
    const r = await syncTargets([{ slug: "bomb-enemy", lists: ["uber"] }], {
      ...baseOpts,
      neetcodeFallback: true,
      fetchProblem: async () => live({ slug: "bomb-enemy", isPaidOnly: true }),
      fetchNeetcode: async () => null,
      write: async (f, c) => void (files[f] = c),
    });
    expect(r.missed[0]!.reason).toBe("premium");
    expect(files["1-bomb-enemy.cpp"]).toContain("NO C++ STARTER AVAILABLE");
  });

  test("records a not-found miss when LeetCode has no such slug", async () => {
    const r = await syncTargets([{ slug: "nope", lists: ["x"] }], {
      ...baseOpts,
      fetchProblem: async () => {
        throw new Error('LeetCode has no problem with slug "nope"');
      },
      write: async () => {},
    });
    expect(r.missed[0]!.reason).toBe("not-found");
  });
});

describe("missingManifest", () => {
  test("groups by reason and notes recovered problems", () => {
    const md = missingManifest([
      { slug: "meeting-rooms", lists: ["citadel"], reason: "premium", recoveredFromNeetcode: true },
      { slug: "combine-two-tables", lists: ["uber"], reason: "sql" },
    ]);
    expect(md).toContain("LeetCode Premium");
    expect(md).toContain("Database / SQL-only");
    expect(md).toContain("meeting-rooms");
    expect(md).toContain("recovered from NeetCode");
  });
});
