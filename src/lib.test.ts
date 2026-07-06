import { expect, test, describe } from "bun:test";
import { slugify, problemUrl, parseRawList, normalizeDifficulty, parseAcceptance } from "./parse.ts";
import { filterProblems, sortProblems, findProblem, pickRandom } from "./lib.ts";
import type { Problem } from "./types.ts";

describe("slugify", () => {
  const cases: [string, string][] = [
    ["Two Sum", "two-sum"],
    ["Pow(x, n)", "powx-n"],
    ["Sqrt(x)", "sqrtx"],
    ["String to Integer (atoi)", "string-to-integer-atoi"],
    ["All O`one Data Structure", "all-oone-data-structure"],
    ["Insert Delete GetRandom O(1)", "insert-delete-getrandom-o1"],
    ["Insert Delete GetRandom O(1) - Duplicates allowed", "insert-delete-getrandom-o1-duplicates-allowed"],
    ["Number of Ways to Paint N × 3 Grid", "number-of-ways-to-paint-n-3-grid"],
    ["01 Matrix", "01-matrix"],
    ["3Sum", "3sum"],
    ["H-Index", "h-index"],
    ["N-Queens", "n-queens"],
    ["Is Graph Bipartite?", "is-graph-bipartite"],
  ];
  for (const [title, slug] of cases) {
    test(`${title} -> ${slug}`, () => expect(slugify(title)).toBe(slug));
  }
});

test("problemUrl", () => {
  expect(problemUrl("two-sum")).toBe("https://leetcode.com/problems/two-sum/");
});

describe("parseAcceptance", () => {
  test("percent", () => expect(parseAcceptance("57.7%")).toBe(57.7));
  test("dash -> null", () => expect(parseAcceptance("—")).toBeNull());
  test("empty -> null", () => expect(parseAcceptance("")).toBeNull());
});

describe("normalizeDifficulty", () => {
  test("Med. -> Medium", () => expect(normalizeDifficulty("Med.")).toBe("Medium"));
  test("Easy", () => expect(normalizeDifficulty("Easy")).toBe("Easy"));
  test("Hard", () => expect(normalizeDifficulty("Hard")).toBe("Hard"));
  test("unknown throws", () => expect(() => normalizeDifficulty("Nope")).toThrow());
});

test("parseRawList parses a 3-line block", () => {
  const problems = parseRawList("1. Two Sum\n57.7%\nEasy\n\n42. Trapping Rain Water\n67.7%\nHard");
  expect(problems).toHaveLength(2);
  expect(problems[0]).toEqual({
    id: 1,
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    acceptance: 57.7,
    difficulty: "Easy",
  });
  expect(problems[1]!.difficulty).toBe("Hard");
});

test("parseRawList tolerates a truncated final block", () => {
  const problems = parseRawList("398. Random Pick Index");
  expect(problems[0]).toMatchObject({ id: 398, acceptance: null, difficulty: "Medium" });
});

const sample: Problem[] = [
  { id: 1, title: "Two Sum", slug: "two-sum", url: "", acceptance: 57.7, difficulty: "Easy" },
  { id: 42, title: "Trapping Rain Water", slug: "trapping-rain-water", url: "", acceptance: 67.7, difficulty: "Hard" },
  { id: 3, title: "Longest Substring", slug: "longest-substring", url: "", acceptance: 39.4, difficulty: "Medium" },
  { id: 9, title: "Palindrome Number", slug: "palindrome-number", url: "", acceptance: null, difficulty: "Easy" },
];

describe("filterProblems", () => {
  test("by difficulty", () => {
    expect(filterProblems(sample, { difficulty: "Easy" }).map((p) => p.id)).toEqual([1, 9]);
  });
  test("min acceptance excludes nulls", () => {
    expect(filterProblems(sample, { minAcceptance: 50 }).map((p) => p.id)).toEqual([1, 42]);
  });
  test("max acceptance", () => {
    expect(filterProblems(sample, { maxAcceptance: 50 }).map((p) => p.id)).toEqual([3]);
  });
  test("search is case-insensitive", () => {
    expect(filterProblems(sample, { search: "sum" }).map((p) => p.id)).toEqual([1]);
  });
});

describe("sortProblems", () => {
  test("by id", () => {
    expect(sortProblems(sample, "id").map((p) => p.id)).toEqual([1, 3, 9, 42]);
  });
  test("by acceptance, nulls last", () => {
    expect(sortProblems(sample, "acc").map((p) => p.id)).toEqual([3, 1, 42, 9]);
  });
  test("desc by id", () => {
    expect(sortProblems(sample, "id", true).map((p) => p.id)).toEqual([42, 9, 3, 1]);
  });
  test("does not mutate input", () => {
    const before = sample.map((p) => p.id);
    sortProblems(sample, "acc");
    expect(sample.map((p) => p.id)).toEqual(before);
  });
});

describe("findProblem", () => {
  test("by id", () => expect(findProblem(sample, "42")?.title).toBe("Trapping Rain Water"));
  test("by slug", () => expect(findProblem(sample, "two-sum")?.id).toBe(1));
  test("missing", () => expect(findProblem(sample, "999")).toBeUndefined());
});

test("pickRandom returns a member, empty -> undefined", () => {
  expect(sample).toContain(pickRandom(sample));
  expect(pickRandom([])).toBeUndefined();
});
