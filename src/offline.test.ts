import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadList, availableLists, filterProblems, sortProblems } from "./lib.ts";
import { recommendProblems } from "./recommend.ts";
import { neetcodeChart } from "./roadmap.ts";
import { resolveDescription } from "./description.ts";
import { buildSolutionFile, hasStatementBlock } from "./solution-file.ts";
import { EMBEDDED_LISTS } from "./lists.generated.ts";
import { embeddedCpp, embeddedDescription } from "./artifacts.ts";

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

  test("the roadmap DAG builds offline", () => {
    expect(neetcodeChart().rows.flat().length).toBe(18);
    expect(fetchCalls).toBe(0);
  });
});

describe("a fresh install serves problem data from the embedded bundle", () => {
  // No on-disk cache (fresh data dir) and fetch is trapped: proves the compiled
  // artifact bundle answers preview + scaffold with zero network — the core of
  // "everything is cached locally on install".
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env.LEET_DATA_DIR = "/tmp/leet-fresh-install-" + Math.floor(performance.now());
    delete process.env.LEET_OFFLINE; // even ONLINE, the bundle must answer first
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  const twoSum = {
    id: 1,
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    acceptance: 50,
    difficulty: "Easy" as const,
  };

  test("preview resolves from the bundle (source=cache), no fetch", async () => {
    const r = await resolveDescription(twoSum);
    expect(r.source).toBe("cache"); // getCachedDescription → embedded bundle
    expect(r.text.length).toBeGreaterThan(0);
    expect(fetchCalls).toBe(0);
  });

  test("scaffold builds from the bundle with its statement + harness, no fetch", async () => {
    const cpp = await buildSolutionFile(twoSum, async () => {
      throw new Error("scaffoldFresh must not run — the bundle should answer");
    });
    expect(cpp).toContain("int main()"); // test harness present
    expect(hasStatementBlock(cpp)).toBe(true); // statement embedded
    expect(fetchCalls).toBe(0);
  });

  test("every bundled slug has an embedded cpp + description", () => {
    // The whole point: no problem across the bundled lists needs the network.
    const slugs = new Set<string>();
    for (const list of Object.values(EMBEDDED_LISTS)) {
      for (const p of list.problems) slugs.add(p.slug);
    }
    let covered = 0;
    for (const slug of slugs) {
      if (embeddedCpp(slug) && embeddedDescription(slug)) covered++;
    }
    // Allow a tiny tail of premium/SQL problems the repo never packaged.
    expect(covered).toBeGreaterThanOrEqual(slugs.size - 5);
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
