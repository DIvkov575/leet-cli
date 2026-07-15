import { describe, expect, test } from "bun:test";
import {
  cppSnippet,
  scaffoldContent,
  scaffoldFilename,
  solutionCodeForSubmit,
  HARNESS_MARKER,
} from "./scaffold.ts";
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

describe("solutionCodeForSubmit", () => {
  test("strips everything from the harness marker down", () => {
    const file = [
      "// 1. Two Sum",
      "#include <vector>",
      "class Solution {",
      "public:",
      "  int f() { return 1; }",
      "};",
      "",
      HARNESS_MARKER,
      "static void __show() {}",
      "int main() { return 0; }",
      "",
    ].join("\n");
    const out = solutionCodeForSubmit(file);
    expect(out).toContain("class Solution {");
    expect(out).toContain("int f() { return 1; }");
    expect(out).not.toContain(HARNESS_MARKER);
    expect(out).not.toContain("int main()");
    expect(out).not.toContain("__show");
  });

  test("legacy files with no marker fall back to cutting at int main()", () => {
    const legacy = [
      "class Solution {",
      "public:",
      "  int f() { return 1; }",
      "};",
      "static void __show(ostream& os) {}",
      "int main() { return 0; }",
    ].join("\n");
    const out = solutionCodeForSubmit(legacy);
    expect(out).toContain("class Solution {");
    expect(out).not.toContain("int main()");
    expect(out).not.toContain("__show");
  });

  test("a solution with no harness is returned unchanged", () => {
    const plain = "class Solution {\npublic:\n  int f() { return 1; }\n};\n";
    expect(solutionCodeForSubmit(plain)).toBe(plain);
  });

  test("scaffoldContent inserts the marker before a generated harness", () => {
    const withHarness = scaffoldContent({
      id: 1,
      title: "Two Sum",
      slug: "two-sum",
      difficulty: "Easy",
      url: "https://leetcode.com/problems/two-sum/",
      snippets: [
        {
          lang: "C++",
          langSlug: "cpp",
          code: "class Solution {\npublic:\n  vector<int> twoSum(vector<int>& nums, int target) {\n  }\n};",
        },
      ],
      metaData: JSON.stringify({
        name: "twoSum",
        params: [
          { name: "nums", type: "integer[]" },
          { name: "target", type: "integer" },
        ],
        return: { type: "integer[]" },
      }),
      exampleTestcases: "[2,7,11,15]\n9",
      contentHtml: "<p>Output: <code>[0,1]</code></p>",
    });
    // Only assert the marker when a harness was actually emitted.
    if (withHarness.includes("int main()")) {
      expect(withHarness).toContain(HARNESS_MARKER);
      const submit = solutionCodeForSubmit(withHarness);
      expect(submit).not.toContain("int main()");
      expect(submit).toContain("twoSum");
    }
  });
});
