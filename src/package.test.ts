import { describe, expect, test } from "bun:test";
import { descriptionMarkdown, packageProblem, stem, testsText } from "./package.ts";
import type { PackageInput } from "./package.ts";

const INPUT: PackageInput = {
  id: 1,
  title: "Two Sum",
  slug: "two-sum",
  difficulty: "Easy",
  url: "https://leetcode.com/problems/two-sum/",
  snippets: [{ lang: "C++", langSlug: "cpp", code: "class Solution {\npublic:\n};" }],
  metaData: JSON.stringify({
    name: "twoSum",
    params: [
      { name: "nums", type: "integer[]" },
      { name: "target", type: "integer" },
    ],
    return: { type: "integer[]" },
  }),
  exampleTestcases: "[2,7,11,15]\n9\n[3,2,4]\n6",
  contentHtml: "<p>Given an array...</p><strong>Output:</strong> [0,1]\n<strong>Output:</strong> [1,2]",
  lists: ["neetcode-250", "uber"],
};

describe("stem", () => {
  test("joins id and slug", () => {
    expect(stem(1, "two-sum")).toBe("1-two-sum");
  });
});

describe("descriptionMarkdown", () => {
  const md = descriptionMarkdown(INPUT);
  test("has a title heading", () => expect(md).toContain("# 1. Two Sum"));
  test("shows difficulty and url", () => {
    expect(md).toContain("**Difficulty:** Easy");
    expect(md).toContain("https://leetcode.com/problems/two-sum/");
  });
  test("lists membership", () => expect(md).toContain("**Lists:** neetcode-250, uber"));
  test("includes the statement text", () => expect(md).toContain("Given an array"));
});

describe("testsText", () => {
  test("returns raw example cases with trailing newline", () => {
    expect(testsText(INPUT)).toBe("[2,7,11,15]\n9\n[3,2,4]\n6\n");
  });
  test("empty when no examples", () => {
    expect(testsText({ ...INPUT, exampleTestcases: undefined })).toBe("");
  });
});

describe("packageProblem", () => {
  const arts = packageProblem(INPUT);
  test("produces md, cpp, and tests files", () => {
    expect(arts.map((a) => a.filename).sort()).toEqual([
      "1-two-sum.cpp",
      "1-two-sum.md",
      "1-two-sum.tests.txt",
    ]);
  });
  test("cpp contains the harness", () => {
    const cpp = arts.find((a) => a.filename.endsWith(".cpp"))!;
    expect(cpp.content).toContain("int main()");
  });
  test("omits tests file when no examples", () => {
    const noTests = packageProblem({ ...INPUT, exampleTestcases: undefined });
    expect(noTests.some((a) => a.filename.endsWith(".tests.txt"))).toBe(false);
  });
});
