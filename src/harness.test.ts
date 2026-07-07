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
  test("returns null for unknown types", () => {
    expect(cppType("ListNode")).toBeNull();
    expect(cppType("TreeNode")).toBeNull();
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

  test("reports unsupported for linked-list signatures", () => {
    const meta: ProblemMeta = {
      name: "addTwoNumbers",
      params: [{ name: "l1", type: "ListNode" }],
      return: { type: "ListNode" },
    };
    const r = generateHarness(meta, [{ args: ["[1]"], expected: "[1]" }]);
    expect(r.supported).toBe(false);
    expect(r.reason).toContain("ListNode");
  });
});
