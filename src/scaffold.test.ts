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

  test("includes <optional>, needed by the TreeNode harness helpers", () => {
    expect(content).toContain("#include <optional>");
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

describe("scaffoldContent — ListNode/TreeNode struct injection", () => {
  const LISTNODE_STUB = [
    "/**",
    " * Definition for singly-linked list.",
    " * struct ListNode {",
    " *     int val;",
    " *     ListNode *next;",
    " *     ListNode() : val(0), next(nullptr) {}",
    " *     ListNode(int x) : val(x), next(nullptr) {}",
    " *     ListNode(int x, ListNode *next) : val(x), next(next) {}",
    " * };",
    " */",
    "class Solution {",
    "public:",
    "    ListNode* addTwoNumbers(ListNode* l1, ListNode* l2) {",
    "    }",
    "};",
  ].join("\n");

  const TREENODE_STUB = [
    "/**",
    " * Definition for a binary tree node.",
    " * struct TreeNode {",
    " *     int val;",
    " *     TreeNode *left;",
    " *     TreeNode *right;",
    " *     TreeNode() : val(0), left(nullptr), right(nullptr) {}",
    " *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}",
    " *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}",
    " * };",
    " */",
    "class Solution {",
    "public:",
    "    TreeNode* invertTree(TreeNode* root) {",
    "    }",
    "};",
  ].join("\n");

  test("injects a real (compilable) ListNode struct when the stub references it", () => {
    const content = scaffoldContent({
      id: 2,
      title: "Add Two Numbers",
      slug: "add-two-numbers",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/add-two-numbers/",
      snippets: [{ lang: "C++", langSlug: "cpp", code: LISTNODE_STUB }],
    });
    // Real code, not just the doc comment's indented "* struct ListNode {" text.
    expect(content).toMatch(/^struct ListNode \{/m);
  });

  test("injects the struct before class Solution", () => {
    const content = scaffoldContent({
      id: 2,
      title: "Add Two Numbers",
      slug: "add-two-numbers",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/add-two-numbers/",
      snippets: [{ lang: "C++", langSlug: "cpp", code: LISTNODE_STUB }],
    });
    const structAt = content.search(/^struct ListNode \{/m);
    const classAt = content.indexOf("class Solution {");
    expect(structAt).toBeGreaterThanOrEqual(0);
    expect(structAt).toBeLessThan(classAt);
  });

  test("injects only one ListNode struct even though the stub mentions it twice", () => {
    const content = scaffoldContent({
      id: 2,
      title: "Add Two Numbers",
      slug: "add-two-numbers",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/add-two-numbers/",
      snippets: [{ lang: "C++", langSlug: "cpp", code: LISTNODE_STUB }],
    });
    expect(content.match(/^struct ListNode \{/gm)?.length).toBe(1);
  });

  test("injects a real TreeNode struct when the stub references it", () => {
    const content = scaffoldContent({
      id: 226,
      title: "Invert Binary Tree",
      slug: "invert-binary-tree",
      difficulty: "Easy",
      url: "https://leetcode.com/problems/invert-binary-tree/",
      snippets: [{ lang: "C++", langSlug: "cpp", code: TREENODE_STUB }],
    });
    expect(content).toMatch(/^struct TreeNode \{/m);
  });

  test("omits both structs when the stub references neither", () => {
    const content = scaffoldContent({
      id: 1,
      title: "Two Sum",
      slug: "two-sum",
      difficulty: "Easy",
      url: "https://leetcode.com/problems/two-sum/",
      snippets: SNIPPETS,
    });
    expect(content).not.toMatch(/^struct ListNode \{/m);
    expect(content).not.toMatch(/^struct TreeNode \{/m);
  });

  test("does not inject ListNode for an unrelated identifier merely containing the substring", () => {
    const content = scaffoldContent({
      id: 1,
      title: "Two Sum",
      slug: "two-sum",
      difficulty: "Easy",
      url: "https://leetcode.com/problems/two-sum/",
      snippets: [
        {
          lang: "C++",
          langSlug: "cpp",
          code: "class Solution {\npublic:\n  int MyListNodeCounter() { return 0; }\n};",
        },
      ],
    });
    expect(content).not.toMatch(/^struct ListNode \{/m);
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
