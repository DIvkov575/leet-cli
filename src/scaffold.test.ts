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

describe("scaffoldContent — the harness model only fits a class Solution", () => {
  // serialize-and-deserialize-binary-tree (and any similar "design" problem)
  // uses a multi-method class — here `Codec`, with serialize/deserialize — not
  // `Solution`. metaData.name for these is the CLASS name, not a method, so
  // generateHarness would emit `Solution().Codec(...)`: nonsense C++, since
  // there's no class named Solution and "Codec" isn't a callable method.
  test("no harness when the stub has no class Solution at all", () => {
    const stub = [
      "/**",
      " * Definition for a binary tree node.",
      " * struct TreeNode {",
      " *     int val;",
      " *     TreeNode *left;",
      " *     TreeNode *right;",
      " *     TreeNode(int x) : val(x), left(NULL), right(NULL) {}",
      " * };",
      " */",
      "class Codec {",
      "public:",
      "    string serialize(TreeNode* root) {",
      "    }",
      "    TreeNode* deserialize(string data) {",
      "    }",
      "};",
    ].join("\n");
    const content = scaffoldContent({
      id: 297,
      title: "Serialize and Deserialize Binary Tree",
      slug: "serialize-and-deserialize-binary-tree",
      difficulty: "Hard",
      url: "https://leetcode.com/problems/serialize-and-deserialize-binary-tree/",
      snippets: [{ lang: "C++", langSlug: "cpp", code: stub }],
      metaData: JSON.stringify({
        name: "Codec",
        params: [{ name: "root", type: "TreeNode" }],
        return: { type: "string" },
      }),
      exampleTestcases: "[1,2,3,null,null,4,5]\n[]",
      contentHtml: "<strong>Output:</strong> [1,2,3,null,null,4,5]\n<strong>Output:</strong> []\n",
    });
    expect(content).not.toContain("int main()");
    expect(content).not.toContain("Solution().Codec");
  });

  test("still emits a harness for a genuine class Solution problem", () => {
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
          code: "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n    }\n};",
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
      contentHtml: "<strong>Output:</strong> [0,1]\n",
    });
    expect(content).toContain("int main()");
  });
});

describe("scaffoldContent — metaData claims ListNode/TreeNode but the stub uses a different struct", () => {
  // LeetCode's own metaData is occasionally wrong: copy-list-with-random-pointer
  // and populating-next-right-pointers-in-each-node-ii report param/return type
  // "ListNode"/"TreeNode", but the actual C++ stub defines and uses a
  // differently-shaped `Node` struct (an extra random/next field) — never the
  // bare identifier ListNode/TreeNode. Trusting metaData blindly would emit a
  // harness referencing a type that doesn't exist in the file.
  const RANDOM_POINTER_STUB = [
    "/*",
    "// Definition for a Node.",
    "class Node {",
    "public:",
    "    int val;",
    "    Node* next;",
    "    Node* random;",
    "    Node(int _val) { val = _val; next = NULL; random = NULL; }",
    "};",
    "*/",
    "",
    "class Solution {",
    "public:",
    "    Node* copyRandomList(Node* head) {",
    "    }",
    "};",
  ].join("\n");

  test("does not emit a harness when the stub's real type is Node, not ListNode", () => {
    const content = scaffoldContent({
      id: 138,
      title: "Copy List with Random Pointer",
      slug: "copy-list-with-random-pointer",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/copy-list-with-random-pointer/",
      snippets: [{ lang: "C++", langSlug: "cpp", code: RANDOM_POINTER_STUB }],
      metaData: JSON.stringify({
        name: "copyRandomList",
        params: [{ name: "head", type: "ListNode" }],
        return: { type: "ListNode" },
      }),
      exampleTestcases: "[[7,null],[13,0]]",
      contentHtml: "<strong>Output:</strong> [[7,null],[13,0]]\n",
    });
    expect(content).not.toContain("int main()");
    // And it must not inject a ListNode struct either — the stub never uses it.
    expect(content).not.toMatch(/^struct ListNode \{/m);
  });

  const NEXT_POINTER_TREE_STUB = [
    "/*",
    "// Definition for a Node.",
    "class Node {",
    "public:",
    "    int val;",
    "    Node* left;",
    "    Node* right;",
    "    Node* next;",
    "    Node() : val(0), left(NULL), right(NULL), next(NULL) {}",
    "};",
    "*/",
    "",
    "class Solution {",
    "public:",
    "    Node* connect(Node* root) {",
    "    }",
    "};",
  ].join("\n");

  test("does not emit a harness when metaData claims TreeNode but the stub's real type is Node", () => {
    const content = scaffoldContent({
      id: 117,
      title: "Populating Next Right Pointers in Each Node II",
      slug: "populating-next-right-pointers-in-each-node-ii",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/populating-next-right-pointers-in-each-node-ii/",
      snippets: [{ lang: "C++", langSlug: "cpp", code: NEXT_POINTER_TREE_STUB }],
      metaData: JSON.stringify({
        name: "connect",
        params: [{ name: "root", type: "TreeNode" }],
        return: { type: "TreeNode" },
      }),
      exampleTestcases: "[1,2,3,4,5,null,7]",
      contentHtml: "<strong>Output:</strong> [1,#,2,3,#,4,5,7,#]\n",
    });
    expect(content).not.toContain("int main()");
    expect(content).not.toMatch(/^struct TreeNode \{/m);
  });

  test("still emits a harness for a genuine ListNode problem (no false positive)", () => {
    const content = scaffoldContent({
      id: 2,
      title: "Add Two Numbers",
      slug: "add-two-numbers",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/add-two-numbers/",
      snippets: [
        {
          lang: "C++",
          langSlug: "cpp",
          code: [
            "/**",
            " * Definition for singly-linked list.",
            " * struct ListNode {",
            " *     int val;",
            " *     ListNode *next;",
            " *     ListNode(int x) : val(x), next(NULL) {}",
            " * };",
            " */",
            "class Solution {",
            "public:",
            "    ListNode* addTwoNumbers(ListNode* l1, ListNode* l2) {",
            "    }",
            "};",
          ].join("\n"),
        },
      ],
      metaData: JSON.stringify({
        name: "addTwoNumbers",
        params: [
          { name: "l1", type: "ListNode" },
          { name: "l2", type: "ListNode" },
        ],
        return: { type: "ListNode" },
      }),
      exampleTestcases: "[2,4,3]\n[5,6,4]",
      contentHtml: "<strong>Output:</strong> [7,0,8]\n",
    });
    expect(content).toContain("int main()");
  });
});

describe("scaffoldContent — slugs where metaData's param count doesn't match the real testcases", () => {
  // linked-list-cycle, linked-list-cycle-ii, and delete-node-in-a-linked-list all
  // have exactly 1 param in metaData, but LeetCode's exampleTestcases carries an
  // extra line per case (a "pos" index, or an unreachable head) that isn't a real
  // parameter. Left unguarded, generateHarness happily builds a "supported"
  // harness from the misaligned cases — which then fails *correct* solutions.
  // These slugs are denylisted so scaffoldContent never emits that harness.
  const CYCLE_LISTNODE_STUB = [
    "class Solution {",
    "public:",
    "    bool hasCycle(ListNode *head) {",
    "    }",
    "};",
  ].join("\n");

  test("linked-list-cycle never emits a harness, regardless of metaData", () => {
    const content = scaffoldContent({
      id: 141,
      title: "Linked List Cycle",
      slug: "linked-list-cycle",
      difficulty: "Easy",
      url: "https://leetcode.com/problems/linked-list-cycle/",
      snippets: [{ lang: "C++", langSlug: "cpp", code: CYCLE_LISTNODE_STUB }],
      metaData: JSON.stringify({
        name: "hasCycle",
        params: [{ name: "head", type: "ListNode" }],
        return: { type: "boolean" },
      }),
      // Real shape: an extra "pos" line per case beyond the single declared param.
      exampleTestcases: "[3,2,0,-4]\n1\n[1,2]\n0\n[1]\n-1",
      contentHtml:
        "<strong>Output:</strong> true\n<strong>Output:</strong> true\n<strong>Output:</strong> false\n",
    });
    expect(content).not.toContain("int main()");
    expect(content.toLowerCase()).toContain("cycle");
  });

  test("linked-list-cycle-ii never emits a harness", () => {
    const content = scaffoldContent({
      id: 142,
      title: "Linked List Cycle II",
      slug: "linked-list-cycle-ii",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/linked-list-cycle-ii/",
      snippets: [
        {
          lang: "C++",
          langSlug: "cpp",
          code: "class Solution {\npublic:\n    ListNode *detectCycle(ListNode *head) {\n    }\n};",
        },
      ],
      metaData: JSON.stringify({
        name: "detectCycle",
        params: [{ name: "head", type: "ListNode" }],
        return: { type: "ListNode" },
      }),
      exampleTestcases: "[3,2,0,-4]\n1\n[1,2]\n0\n[1]\n-1",
      contentHtml: "<strong>Output:</strong> tail connects to node index 1\n",
    });
    expect(content).not.toContain("int main()");
  });

  test("delete-node-in-a-linked-list never emits a harness", () => {
    const content = scaffoldContent({
      id: 237,
      title: "Delete Node in a Linked List",
      slug: "delete-node-in-a-linked-list",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/delete-node-in-a-linked-list/",
      snippets: [
        {
          lang: "C++",
          langSlug: "cpp",
          code: "class Solution {\npublic:\n    void deleteNode(ListNode* node) {\n    }\n};",
        },
      ],
      metaData: JSON.stringify({
        name: "deleteNode",
        params: [{ name: "node", type: "ListNode" }],
        return: { type: "void" },
      }),
      // Real shape: head + node-value, but metaData only declares "node".
      exampleTestcases: "[4,5,1,9]\n5\n[4,5,1,9]\n1",
      contentHtml: "<strong>Output:</strong> [4,1,9]\n<strong>Output:</strong> [4,5,9]\n",
    });
    expect(content).not.toContain("int main()");
  });

  test("all-nodes-distance-k-in-binary-tree never emits a harness", () => {
    // Real shape: metaData declares "target" as `integer`, but the actual C++
    // signature takes `TreeNode* target` — LeetCode's judge looks up the node
    // by value inside the already-built tree and passes the pointer. The
    // per-parameter literal builder has no way to do that lookup.
    const content = scaffoldContent({
      id: 863,
      title: "All Nodes Distance K in Binary Tree",
      slug: "all-nodes-distance-k-in-binary-tree",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/all-nodes-distance-k-in-binary-tree/",
      snippets: [
        {
          lang: "C++",
          langSlug: "cpp",
          code: "class Solution {\npublic:\n    vector<int> distanceK(TreeNode* root, TreeNode* target, int k) {\n    }\n};",
        },
      ],
      metaData: JSON.stringify({
        name: "distanceK",
        params: [
          { name: "root", type: "TreeNode" },
          { name: "target", type: "integer" },
          { name: "k", type: "integer" },
        ],
        return: { type: "list<integer>" },
      }),
      exampleTestcases: "[3,5,1,6,2,0,8,null,null,7,4]\n5\n2",
      contentHtml: "<strong>Output:</strong> [7,4,1]\n",
    });
    expect(content).not.toContain("int main()");
  });

  test("lowest-common-ancestor-of-a-binary-search-tree never emits a harness", () => {
    const content = scaffoldContent({
      id: 235,
      title: "Lowest Common Ancestor of a Binary Search Tree",
      slug: "lowest-common-ancestor-of-a-binary-search-tree",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-search-tree/",
      snippets: [
        {
          lang: "C++",
          langSlug: "cpp",
          code: "class Solution {\npublic:\n    TreeNode* lowestCommonAncestor(TreeNode* root, TreeNode* p, TreeNode* q) {\n    }\n};",
        },
      ],
      metaData: JSON.stringify({
        name: "lowestCommonAncestor",
        params: [
          { name: "root", type: "TreeNode" },
          { name: "p", type: "integer" },
          { name: "q", type: "integer" },
        ],
        return: { type: "TreeNode" },
      }),
      exampleTestcases: "[6,2,8,0,4,7,9,null,null,3,5]\n2\n8",
      contentHtml: "<strong>Output:</strong> 6\n",
    });
    expect(content).not.toContain("int main()");
  });

  test("a different problem that happens to share the method name is unaffected", () => {
    // Guards against a naive name-based (rather than slug-based) denylist.
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
          code: "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n    }\n};",
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
      contentHtml: "<strong>Output:</strong> [0,1]\n",
    });
    expect(content).toContain("int main()");
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
