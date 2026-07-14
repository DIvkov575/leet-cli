import { describe, expect, test } from "bun:test";
import {
  recommendProblems,
  getStrategy,
  popularityStrategy,
  excludeLists,
  DEFAULT_STRATEGY,
} from "./recommend.ts";
import type { ProblemList, Difficulty } from "./types.ts";

function P(id: number, acc: number | null, diff: Difficulty = "Medium") {
  return { id, title: `P${id}`, slug: `p${id}`, url: "u", acceptance: acc, difficulty: diff };
}

// two-sum(1) in 3 lists, p2 in 2 lists, p3 in 1 list.
const lists: ProblemList[] = [
  { name: "a", title: "A", problems: [P(1, 50), P(2, 60), P(3, 70)] },
  { name: "b", title: "B", problems: [P(1, 50), P(2, 60)] },
  { name: "c", title: "C", problems: [P(1, 50)] },
];

describe("popularityStrategy", () => {
  test("ranks by number of lists a problem appears in", () => {
    const recs = popularityStrategy(lists, {});
    expect(recs.map((r) => r.problem.id)).toEqual([1, 2, 3]);
    expect(recs[0]!.listCount).toBe(3);
    expect(recs[0]!.lists).toEqual(["a", "b", "c"]);
    expect(recs[2]!.listCount).toBe(1);
  });

  test("breaks ties by higher acceptance", () => {
    const tied: ProblemList[] = [
      { name: "x", title: "X", problems: [P(10, 30), P(11, 90)] }, // both in 1 list
    ];
    const recs = popularityStrategy(tied, {});
    expect(recs.map((r) => r.problem.id)).toEqual([11, 10]); // 90% before 30%
  });

  test("flags done and can exclude them", () => {
    const done = new Set([1]);
    const withDone = popularityStrategy(lists, { completed: done });
    expect(withDone.find((r) => r.problem.id === 1)!.done).toBe(true);

    const excluded = popularityStrategy(lists, { completed: done, excludeDone: true });
    expect(excluded.some((r) => r.problem.id === 1)).toBe(false);
    expect(excluded.map((r) => r.problem.id)).toEqual([2, 3]);
  });

  test("applies limit after ranking", () => {
    expect(popularityStrategy(lists, { limit: 2 }).map((r) => r.problem.id)).toEqual([1, 2]);
  });

  test("de-dupes: a problem in N lists appears once", () => {
    const recs = popularityStrategy(lists, {});
    expect(recs.filter((r) => r.problem.id === 1)).toHaveLength(1);
  });
});

describe("getStrategy", () => {
  test("unknown name falls back to the default", () => {
    expect(getStrategy("nonsense")).toBe(getStrategy(DEFAULT_STRATEGY));
  });
  test("default is popularity", () => {
    expect(DEFAULT_STRATEGY).toBe("popularity");
  });
});

describe("recommendProblems", () => {
  test("acceptance strategy ranks most-approachable first", () => {
    const recs = recommendProblems(lists, "acceptance", { limit: 1 });
    expect(recs[0]!.problem.id).toBe(3); // 70% is highest acceptance
  });
});

describe("excludeLists", () => {
  test("no exclusions -> every list counts (the default)", () => {
    expect(excludeLists(lists, []).map((l) => l.name)).toEqual(["a", "b", "c"]);
    expect(excludeLists(lists, undefined).map((l) => l.name)).toEqual(["a", "b", "c"]);
  });

  test("drops the named lists from the pool", () => {
    expect(excludeLists(lists, ["b"]).map((l) => l.name)).toEqual(["a", "c"]);
    expect(excludeLists(lists, ["a", "c"]).map((l) => l.name)).toEqual(["b"]);
  });

  test("matching is case-insensitive and tolerates unknown names", () => {
    expect(excludeLists(lists, ["B", "  c  "]).map((l) => l.name)).toEqual(["a"]);
    expect(excludeLists(lists, ["nonexistent"]).map((l) => l.name)).toEqual(["a", "b", "c"]);
  });

  test("excluding every list empties the pool", () => {
    expect(excludeLists(lists, ["a", "b", "c"])).toEqual([]);
    expect(popularityStrategy(excludeLists(lists, ["a", "b", "c"]), {})).toEqual([]);
  });
});

describe("recommendations reflect only the non-excluded lists", () => {
  test("excluding a list lowers listCount and can drop a problem entirely", () => {
    // p3 lives only in list "a"; excluding "a" must drop it.
    const recs = popularityStrategy(excludeLists(lists, ["a"]), {});
    expect(recs.some((r) => r.problem.id === 3)).toBe(false);

    // p1 was in 3 lists; with "a" excluded it is in b + c.
    const p1 = recs.find((r) => r.problem.id === 1)!;
    expect(p1.listCount).toBe(2);
    expect(p1.lists).toEqual(["b", "c"]);
  });

  test("the popularity ranking itself follows the remaining set", () => {
    // Excluding b + c leaves only list "a": all three tied at 1 list, so
    // acceptance breaks the tie: p3(70) > p2(60) > p1(50).
    const recs = popularityStrategy(excludeLists(lists, ["b", "c"]), {});
    expect(recs.map((r) => r.problem.id)).toEqual([3, 2, 1]);
  });
});
