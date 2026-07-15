import { describe, expect, test } from "bun:test";
import { subsequenceScore, scoreProblem, fuzzyRankProblems } from "./fuzzy.ts";
import type { Problem } from "./types.ts";

describe("subsequenceScore", () => {
  test("empty query scores 0", () => expect(subsequenceScore("", "anything")).toBe(0));
  test("substring matches", () => expect(subsequenceScore("sum", "two sum")).not.toBeNull());
  test("gapped subsequence matches", () => expect(subsequenceScore("twsm", "two sum")).not.toBeNull());
  test("non-subsequence returns null", () => expect(subsequenceScore("xyz", "two sum")).toBeNull());
  test("out-of-order returns null", () => expect(subsequenceScore("mus", "sum")).toBeNull());
  test("substring outscores a gapped match", () => {
    const sub = subsequenceScore("sum", "two sum")!;
    const gap = subsequenceScore("tsm", "two sum")!;
    expect(sub).toBeGreaterThan(gap);
  });
  test("word-boundary / earlier match scores higher", () => {
    const early = subsequenceScore("two", "two sum")!;
    const late = subsequenceScore("sum", "two sum")!;
    expect(early).toBeGreaterThan(late);
  });
});

const P = (over: Partial<Problem>): Problem => ({
  id: 1,
  title: "Two Sum",
  slug: "two-sum",
  url: "u",
  acceptance: 50,
  difficulty: "Easy",
  ...over,
});

describe("scoreProblem", () => {
  test("matches on title", () => expect(scoreProblem("sum", P({}))).not.toBeNull());
  test("matches on pattern", () =>
    expect(scoreProblem("hashing", P({ title: "X", slug: "x", pattern: "Arrays & Hashing" }))).not.toBeNull());
  test("matches on a topic", () =>
    expect(scoreProblem("dfs", P({ title: "X", slug: "x", topics: ["depth-first-search", "dfs"] }))).not.toBeNull());
  test("matches on company (list membership)", () =>
    expect(scoreProblem("google", P({ title: "X", slug: "x" }), ["google", "meta"])).not.toBeNull());
  test("no match anywhere → null", () =>
    expect(scoreProblem("zzzq", P({ title: "X", slug: "x", topics: ["array"] }))).toBeNull());
});

describe("fuzzyRankProblems", () => {
  const problems: Problem[] = [
    P({ id: 1, title: "Two Sum", slug: "two-sum", pattern: "Arrays & Hashing", topics: ["array", "hash-table"] }),
    P({ id: 2, title: "Add Two Numbers", slug: "add-two-numbers", pattern: "Linked List", topics: ["linked-list"] }),
    P({ id: 3, title: "Number of Islands", slug: "number-of-islands", pattern: "Graphs", topics: ["graph", "bfs", "dfs"] }),
  ];

  test("blank query keeps original order", () => {
    expect(fuzzyRankProblems(problems, "").map((p) => p.id)).toEqual([1, 2, 3]);
  });
  test("title match ranks first", () => {
    const out = fuzzyRankProblems(problems, "islands");
    expect(out[0]!.id).toBe(3);
  });
  test("tag search finds by pattern", () => {
    const out = fuzzyRankProblems(problems, "graphs");
    expect(out.map((p) => p.id)).toContain(3);
  });
  test("company search uses membership map", () => {
    const companiesOf = (p: Problem) => (p.id === 2 ? ["google"] : []);
    const out = fuzzyRankProblems(problems, "google", companiesOf);
    expect(out.map((p) => p.id)).toEqual([2]);
  });
  test("gapped fuzzy title match works", () => {
    const out = fuzzyRankProblems(problems, "twosm"); // Two Sum
    expect(out[0]!.id).toBe(1);
  });
  test("drops non-matches", () => {
    expect(fuzzyRankProblems(problems, "zzzq")).toEqual([]);
  });
});
