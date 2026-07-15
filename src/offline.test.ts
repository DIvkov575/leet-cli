import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadList, availableLists, filterProblems, sortProblems } from "./lib.ts";
import { recommendProblems } from "./recommend.ts";
import { neetcodeChart, fullChart } from "./roadmap.ts";
import { topicsByPattern } from "./tags.ts";
import { resolveDescription } from "./description.ts";

/**
 * The offline contract: browsing, filtering, sorting, recommending, and roadmap
 * generation must never touch the network — online or off. We enforce it by
 * replacing global fetch (and gh spawns are covered by the net gate) with a trap
 * that fails the test if called, then exercising each read path.
 */
const realFetch = globalThis.fetch;
let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async (...args: unknown[]) => {
    fetchCalls++;
    throw new Error(`network call attempted offline: ${String(args[0])}`);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("core paths never hit the network", () => {
  test("loading + filtering + sorting every bundled list is offline", async () => {
    for (const name of await availableLists()) {
      const list = await loadList(name);
      const filtered = filterProblems(list.problems, {
        difficulty: "Medium",
        patterns: ["Graphs"],
        search: "sum",
      });
      sortProblems(filtered, "acc", true);
    }
    expect(fetchCalls).toBe(0);
  });

  test("the 'all' union list is offline", async () => {
    const all = await loadList("all");
    expect(all.problems.length).toBeGreaterThan(0);
    expect(fetchCalls).toBe(0);
  });

  test("recommendations compute offline", async () => {
    const lists = await Promise.all((await availableLists()).map((n) => loadList(n)));
    const recs = recommendProblems(lists, "popularity");
    expect(recs.length).toBeGreaterThan(0);
    expect(fetchCalls).toBe(0);
  });

  test("both roadmap charts build offline", () => {
    expect(neetcodeChart().rows.flat().length).toBe(18);
    expect(fullChart(topicsByPattern()).rows.flat().length).toBeGreaterThan(18);
    expect(fetchCalls).toBe(0);
  });
});

describe("offline mode degrades the preview instead of fetching", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env.LEET_OFFLINE = "1";
    process.env.LEET_DATA_DIR = "/tmp/leet-offline-test-" + Math.floor(performance.now());
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test("resolveDescription returns an offline placeholder, not a fetch", async () => {
    const problem = {
      id: 1,
      title: "Two Sum",
      slug: "two-sum-uncached-xyz",
      url: "u",
      acceptance: null,
      difficulty: "Easy" as const,
    };
    const r = await resolveDescription(problem);
    expect(r.source).toBe("offline");
    expect(r.text).toContain("offline mode is on");
    expect(fetchCalls).toBe(0);
  });
});
