import { describe, expect, test } from "bun:test";
import { hasStatementBlock, withStatement } from "./solution-file.ts";

const HEADER_ONLY = [
  "// 1. Two Sum [Easy]",
  "// https://leetcode.com/problems/two-sum/",
  "",
  "#include <vector>",
  "using namespace std;",
  "class Solution { public: };",
  "",
].join("\n");

const WITH_STATEMENT = [
  "// 1. Two Sum [Easy]",
  "// https://leetcode.com/problems/two-sum/",
  "//",
  "// Given an array of integers…",
  "",
  "#include <vector>",
].join("\n");

describe("hasStatementBlock", () => {
  test("false for a bare id/url header", () => {
    expect(hasStatementBlock(HEADER_ONLY)).toBe(false);
  });
  test("true when a bare // separator is in the header run", () => {
    expect(hasStatementBlock(WITH_STATEMENT)).toBe(true);
  });
});

describe("withStatement", () => {
  test("splices the statement after the id/url header, before the code", () => {
    const out = withStatement(HEADER_ONLY, "Given an array of integers.\n\nReturn indices.");
    const lines = out.split("\n");
    // Header preserved on the first two lines.
    expect(lines[0]).toBe("// 1. Two Sum [Easy]");
    expect(lines[1]).toBe("// https://leetcode.com/problems/two-sum/");
    // Statement follows as // comments, blank line -> bare "//".
    expect(out).toContain("// Given an array of integers.");
    expect(out).toContain("// Return indices.");
    // The code still comes after the comment header.
    expect(out.indexOf("Given an array")).toBeLessThan(out.indexOf("#include"));
    // Original code is intact.
    expect(out).toContain("class Solution { public: };");
  });

  test("is a no-op when the block is already present (idempotent)", () => {
    expect(withStatement(WITH_STATEMENT, "anything")).toBe(WITH_STATEMENT);
  });

  test("is a no-op when the statement is empty", () => {
    expect(withStatement(HEADER_ONLY, "")).toBe(HEADER_ONLY);
  });

  test("applying twice equals applying once", () => {
    const once = withStatement(HEADER_ONLY, "Some statement.");
    const twice = withStatement(once, "Some statement.");
    expect(twice).toBe(once);
  });
});
