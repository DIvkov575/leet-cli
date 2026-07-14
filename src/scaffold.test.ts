import { describe, expect, test } from "bun:test";
import { cppSnippet, scaffoldContent, scaffoldFilename } from "./scaffold.ts";
import type { CodeSnippet } from "./leetcode.ts";

const SNIPPETS: CodeSnippet[] = [
  { lang: "Python3", langSlug: "python3", code: "class Solution:\n    pass" },
  { lang: "C++", langSlug: "cpp", code: "class Solution {\npublic:\n};" },
];

describe("cppSnippet", () => {
  test("returns the cpp snippet's code", () => {
    expect(cppSnippet(SNIPPETS)).toBe("class Solution {\npublic:\n};");
  });

  test("throws when no cpp snippet is present", () => {
    expect(() => cppSnippet([SNIPPETS[0]!])).toThrow(/no C\+\+ starter/);
  });
});

describe("scaffoldFilename", () => {
  test("combines id and slug with a .cpp extension", () => {
    expect(scaffoldFilename(1, "two-sum")).toBe("1-two-sum.cpp");
  });
});

describe("scaffoldContent", () => {
  const content = scaffoldContent({
    id: 1,
    title: "Two Sum",
    slug: "two-sum",
    difficulty: "Easy",
    url: "https://leetcode.com/problems/two-sum/",
    snippets: SNIPPETS,
  });

  test("includes a header comment with id, title, difficulty", () => {
    expect(content).toContain("// 1. Two Sum [Easy]");
  });

  test("includes the problem URL", () => {
    expect(content).toContain("// https://leetcode.com/problems/two-sum/");
  });

  test("includes the C++ stub and ends with a newline", () => {
    expect(content).toContain("class Solution {");
    expect(content.endsWith("};\n")).toBe(true);
  });

  test("embeds the problem statement as a comment block when contentHtml is given", () => {
    const withDesc = scaffoldContent({
      id: 1,
      title: "Two Sum",
      slug: "two-sum",
      difficulty: "Easy",
      url: "https://leetcode.com/problems/two-sum/",
      snippets: SNIPPETS,
      contentHtml: "<p>Given an array of integers, return indices.</p>",
    });
    // The statement appears as // comments, above the includes, and never
    // leaks into compiled code.
    expect(withDesc).toContain("// Given an array of integers, return indices.");
    expect(withDesc.indexOf("Given an array")).toBeLessThan(withDesc.indexOf("#include"));
  });

  test("omits the statement block when no contentHtml", () => {
    expect(content).not.toContain("// Given an array");
  });
});
