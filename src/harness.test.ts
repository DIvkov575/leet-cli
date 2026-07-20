import { describe, expect, test } from "bun:test";
import {
  buildCases,
  cppType,
  generateHarness,
  jsonToCppLiteral,
  parseExampleArgs,
  parseExpectedOutputs,
  type ProblemMeta,
} from "./harness.ts";

describe("cppType", () => {
  test("maps scalars", () => {
    expect(cppType("integer")).toBe("int");
    expect(cppType("string")).toBe("string");
    expect(cppType("boolean")).toBe("bool");
  });
  test("maps nested arrays", () => {
    expect(cppType("integer[]")).toBe("vector<int>");
    expect(cppType("integer[][]")).toBe("vector<vector<int>>");
  });
  test("maps LeetCode list<T> notation", () => {
    expect(cppType("list<integer>")).toBe("vector<int>");
    expect(cppType("list<string>")).toBe("vector<string>");
    expect(cppType("list<list<integer>>")).toBe("vector<vector<int>>");
  });
  test("maps ListNode/TreeNode to pointer types", () => {
    expect(cppType("ListNode")).toBe("ListNode*");
    expect(cppType("TreeNode")).toBe("TreeNode*");
  });
  test("maps arrays of ListNode/TreeNode", () => {
    expect(cppType("ListNode[]")).toBe("vector<ListNode*>");
    expect(cppType("list<TreeNode>")).toBe("vector<TreeNode*>");
  });
  test("returns null for genuinely unknown types", () => {
    expect(cppType("Node")).toBeNull();
    expect(cppType("Foo")).toBeNull();
  });
});

describe("jsonToCppLiteral", () => {
  test("scalars", () => {
    expect(jsonToCppLiteral(9, "int")).toBe("9");
    expect(jsonToCppLiteral(true, "bool")).toBe("true");
    expect(jsonToCppLiteral("ab", "string")).toBe('"ab"');
  });
  test("vectors", () => {
    expect(jsonToCppLiteral([2, 7, 11], "vector<int>")).toBe("{2,7,11}");
    expect(jsonToCppLiteral([[1, 2], [3]], "vector<vector<int>>")).toBe("{{1,2},{3}}");
  });
  test("ListNode* delegates to the __buildList helper", () => {
    expect(jsonToCppLiteral([2, 4, 3], "ListNode*")).toBe("__buildList({2,4,3})");
  });
  test("TreeNode* delegates to the __buildTree helper, using nullopt for gaps", () => {
    expect(jsonToCppLiteral([4, 2, 7, null, 3], "TreeNode*")).toBe(
      "__buildTree({4,2,7,nullopt,3})",
    );
  });
  test("vector<ListNode*> maps each sub-array through __buildList", () => {
    expect(jsonToCppLiteral([[1, 4, 5], [1, 3, 4], [2, 6]], "vector<ListNode*>")).toBe(
      "{__buildList({1,4,5}),__buildList({1,3,4}),__buildList({2,6})}",
    );
  });
});

describe("parseExampleArgs", () => {
  test("groups lines by param count", () => {
    expect(parseExampleArgs("[2,7,11,15]\n9\n[3,2,4]\n6", 2)).toEqual([
      ["[2,7,11,15]", "9"],
      ["[3,2,4]", "6"],
    ]);
  });
});

describe("parseExpectedOutputs", () => {
  test("extracts each Output value", () => {
    const html = "<strong>Output:</strong> [0,1]\nx<strong>Output:</strong> [1,2]\n";
    expect(parseExpectedOutputs(html)).toEqual(["[0,1]", "[1,2]"]);
  });
});

const TWO_SUM_META: ProblemMeta = {
  name: "twoSum",
  params: [
    { name: "nums", type: "integer[]" },
    { name: "target", type: "integer" },
  ],
  return: { type: "integer[]" },
};

describe("generateHarness", () => {
  test("emits a main that calls the method with literals and checks output", () => {
    const cases = buildCases(
      "[2,7,11,15]\n9\n[3,2,4]\n6",
      "<strong>Output:</strong> [0,1]\n<strong>Output:</strong> [1,2]",
      2,
    );
    const r = generateHarness(TWO_SUM_META, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("int main()");
    // Args are materialized as named locals (non-const refs can't bind to temporaries).
    expect(r.code).toContain("vector<int> __a0 = {2,7,11,15};");
    expect(r.code).toContain("int __a1 = 9;");
    expect(r.code).toContain("Solution().twoSum(__a0, __a1)");
    expect(r.code).toContain("__exp = {0,1}");
    expect(r.code).toContain("passed");
  });

});

describe("generateHarness — ListNode", () => {
  test("builds ListNode* params via __buildList and compares structurally", () => {
    const meta: ProblemMeta = {
      name: "addTwoNumbers",
      params: [
        { name: "l1", type: "ListNode" },
        { name: "l2", type: "ListNode" },
      ],
      return: { type: "ListNode" },
    };
    const cases = buildCases(
      "[2,4,3]\n[5,6,4]",
      "<strong>Output:</strong> [7,0,8]",
      2,
    );
    const r = generateHarness(meta, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("__buildList");
    expect(r.code).toContain("ListNode* __a0 = __buildList({2,4,3});");
    expect(r.code).toContain("ListNode* __a1 = __buildList({5,6,4});");
    expect(r.code).toContain("Solution().addTwoNumbers(__a0, __a1)");
    // Structural equality, not pointer equality.
    expect(r.code).toContain("__eq(__got, __exp)");
    expect(r.code).not.toContain("__got == __exp");
  });

  test("supports a bare ListNode param with a scalar (non-ListNode) return", () => {
    const meta: ProblemMeta = {
      name: "isPalindrome",
      params: [{ name: "head", type: "ListNode" }],
      return: { type: "boolean" },
    };
    const cases = buildCases("[1,2,3]", "<strong>Output:</strong> false", 1);
    const r = generateHarness(meta, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("ListNode* __a0 = __buildList({1,2,3});");
    // Scalar return still uses plain equality, not __eq.
    expect(r.code).toContain("bool __got = Solution().isPalindrome(__a0);");
    expect(r.code).toContain("(__got == __exp)");
  });
});

describe("generateHarness — TreeNode", () => {
  test("builds TreeNode* params/return via __buildTree with nullopt gaps", () => {
    const meta: ProblemMeta = {
      name: "invertTree",
      params: [{ name: "root", type: "TreeNode" }],
      return: { type: "TreeNode" },
    };
    const cases = buildCases(
      "[4,2,7,1,3,6,9]",
      "<strong>Output:</strong> [4,7,2,9,6,3,1]",
      1,
    );
    const r = generateHarness(meta, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("TreeNode* __a0 = __buildTree({4,2,7,1,3,6,9});");
    expect(r.code).toContain("Solution().invertTree(__a0)");
    expect(r.code).toContain("__eq(__got, __exp)");
  });

  test("handles null gaps in level-order tree literals", () => {
    const meta: ProblemMeta = {
      name: "someTreeFn",
      params: [{ name: "root", type: "TreeNode" }],
      return: { type: "boolean" },
    };
    const cases = buildCases("[1,null,2]", "<strong>Output:</strong> true", 1);
    const r = generateHarness(meta, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("__buildTree({1,nullopt,2})");
  });
});

describe("generateHarness — merge-k-sorted-lists shape (vector<ListNode*>)", () => {
  test("builds a vector<ListNode*> param via per-element __buildList", () => {
    const meta: ProblemMeta = {
      name: "mergeKLists",
      params: [{ name: "lists", type: "ListNode[]" }],
      return: { type: "ListNode" },
    };
    const cases = buildCases(
      "[[1,4,5],[1,3,4],[2,6]]",
      "<strong>Output:</strong> [1,1,2,3,4,4,5,6]",
      1,
    );
    const r = generateHarness(meta, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain(
      "vector<ListNode*> __a0 = {__buildList({1,4,5}),__buildList({1,3,4}),__buildList({2,6})};",
    );
    expect(r.code).toContain("Solution().mergeKLists(__a0)");
    expect(r.code).toContain("__eq(__got, __exp)");
  });
});

describe("generateHarness — vector<ListNode*> RETURN (split-linked-list-in-parts shape)", () => {
  // Unlike vector<TreeNode*>, LeetCode's judge for a vector<ListNode*> return
  // (e.g. split-linked-list-in-parts) checks EXACT positional order — there's
  // no order-independence concern here, so this must be supported, not
  // rejected the way the TreeNode-vector case is.
  test("supports a vector<ListNode*> return with elementwise structural comparison", () => {
    const meta: ProblemMeta = {
      name: "splitListToParts",
      params: [
        { name: "head", type: "ListNode" },
        { name: "k", type: "integer" },
      ],
      return: { type: "list<ListNode>" },
    };
    const cases = buildCases(
      "[1,2,3]\n5",
      "<strong>Output:</strong> [[1],[2],[3],[],[]]",
      2,
    );
    const r = generateHarness(meta, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("vector<ListNode*> __got = Solution().splitListToParts(__a0, __a1);");
    expect(r.code).toContain(
      "vector<ListNode*> __exp = {__buildList({1}),__buildList({2}),__buildList({3}),__buildList({}),__buildList({})};",
    );
    // Elementwise structural comparison, not the scalar `==` (pointer identity)
    // and not the single-node __eq(ListNode*,ListNode*) overload directly.
    expect(r.code).toContain("__eq(__got, __exp)");
  });
});

describe("generateHarness — documented gaps get a specific reason", () => {
  test("Node (random-pointer list) is a genuinely unmapped type — generic reason", () => {
    const meta: ProblemMeta = {
      name: "copyRandomList",
      params: [{ name: "head", type: "Node" }],
      return: { type: "Node" },
    };
    const r = generateHarness(meta, [{ args: ["[[1,null]]"], expected: "[[1,null]]" }]);
    expect(r.supported).toBe(false);
    expect(r.reason).toContain("Node");
  });

});

describe("generateHarness — vector<TreeNode*> return is order-independent (all-possible-full-binary-trees shape)", () => {
  test("supports a vector<TreeNode*> return via order-independent multiset comparison", () => {
    const meta: ProblemMeta = {
      name: "allPossibleFBT",
      params: [{ name: "n", type: "integer" }],
      return: { type: "list<TreeNode>" },
    };
    // Real LeetCode example: n=7 -> 5 distinct full binary trees, in some order.
    const r = generateHarness(meta, [
      { args: ["3"], expected: "[[0,0,0]]" },
    ]);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("vector<TreeNode*> __got = Solution().allPossibleFBT(__a0);");
    // Order-independent comparison, not a positional __eq(vector,vector).
    expect(r.code).toContain("__eqUnordered(__got, __exp)");
    expect(r.code).not.toContain("__eq(__got, __exp)");
  });

  test("supports a TreeNode param alongside a vector<TreeNode*> return (delete-nodes-and-return-forest shape)", () => {
    const meta: ProblemMeta = {
      name: "delNodes",
      params: [
        { name: "root", type: "TreeNode" },
        { name: "to_delete", type: "integer[]" },
      ],
      return: { type: "list<TreeNode>" },
    };
    const r = generateHarness(meta, [{ args: ["[1,2,3,4,5,6,7]", "[3,5]"], expected: "[[1,2,4,null,3],[6],[7]]" }]);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("TreeNode* __a0 = __buildTree({1,2,3,4,5,6,7});");
    expect(r.code).toContain("vector<int> __a1 = {3,5};");
    expect(r.code).toContain("Solution().delNodes(__a0, __a1)");
    expect(r.code).toContain("__eqUnordered(__got, __exp)");
  });
});

describe("generateHarness — void return with ListNode/TreeNode (structural observe)", () => {
  test("reorder-list shape: void + ListNode param compares structurally post-call", () => {
    const meta: ProblemMeta = {
      name: "reorderList",
      params: [{ name: "head", type: "ListNode" }],
      return: { type: "void" },
    };
    const cases = buildCases("[1,2,3,4]", "<strong>Output:</strong> [1,4,2,3]", 1);
    const r = generateHarness(meta, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("ListNode* __a0 = __buildList({1,2,3,4});");
    expect(r.code).toContain("Solution().reorderList(__a0);");
    expect(r.code).toContain("__eq(__a0, __exp)");
  });
});

describe("generateHarness — void return (in-place mutation)", () => {
  const SORT_COLORS_META: ProblemMeta = {
    name: "sortColors",
    params: [{ name: "nums", type: "integer[]" }],
    return: { type: "void" },
  };

  test("supports void return by checking the first param's post-call value", () => {
    const cases = buildCases("[2,0,2,1,1,0]", "<strong>Output:</strong> [0,0,1,1,2,2]", 1);
    const r = generateHarness(SORT_COLORS_META, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("int main()");
    expect(r.code).toContain("vector<int> __a0 = {2,0,2,1,1,0};");
    // The call is for side effect only — no return value assigned.
    expect(r.code).toContain("Solution().sortColors(__a0);");
    expect(r.code).not.toContain("__got");
    // Compares the mutated argument, not a return value.
    expect(r.code).toContain("__exp = {0,0,1,1,2,2}");
    expect(r.code).toContain("(__a0 == __exp)");
    expect(r.code).toContain("passed");
  });

  test("multiple params: still observes the first param only", () => {
    const meta: ProblemMeta = {
      name: "merge",
      params: [
        { name: "nums1", type: "integer[]" },
        { name: "m", type: "integer" },
        { name: "nums2", type: "integer[]" },
        { name: "n", type: "integer" },
      ],
      return: { type: "void" },
    };
    const cases = buildCases(
      "[1,2,3,0,0,0]\n3\n[2,5,6]\n3",
      "<strong>Output:</strong> [1,2,2,3,5,6]",
      4,
    );
    const r = generateHarness(meta, cases);
    expect(r.supported).toBe(true);
    expect(r.code).toContain("Solution().merge(__a0, __a1, __a2, __a3);");
    expect(r.code).toContain("(__a0 == __exp)");
  });

  test("reports unsupported when void return has no parameters to observe", () => {
    const meta: ProblemMeta = { name: "doSomething", params: [], return: { type: "void" } };
    const r = generateHarness(meta, []);
    expect(r.supported).toBe(false);
    expect(r.reason).toContain("void");
  });
});
