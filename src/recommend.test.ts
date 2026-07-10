import { describe, expect, test } from "bun:test";
import { recommendProblems, getStrategy, popularityStrategy, DEFAULT_STRATEGY } from "./recommend.ts";
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
