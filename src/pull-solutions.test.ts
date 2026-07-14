import { expect, test, describe } from "bun:test";
import {
  canonicalSlug,
  missingSolvedSlugs,
  submissionPath,
  pullMissingSolutions,
  NEETCODE_TOPIC_DIR,
} from "./pull-solutions.ts";
import type { SolutionCode } from "./leetcode-submissions.ts";

describe("canonicalSlug", () => {
  test("applies a known NeetCode alias", () => {
    expect(canonicalSlug("two-integer-sum")).toBe("two-sum");
    expect(canonicalSlug("rotate-matrix")).toBe("rotate-image");
  });
  test("identity for a folder whose name already matches LeetCode", () => {
    expect(canonicalSlug("add-two-numbers")).toBe("add-two-numbers");
  });
});

describe("missingSolvedSlugs", () => {
  test("treats aliased folders as covering their LeetCode problem", () => {
    // Repo has the NeetCode-named folder; solved list uses the LeetCode slug.
    const missing = missingSolvedSlugs(["two-integer-sum"], ["two-sum", "3sum"]);
    expect(missing).toEqual(["3sum"]);
  });

  test("identity folders are covered too", () => {
    expect(missingSolvedSlugs(["add-two-numbers"], ["add-two-numbers"])).toEqual([]);
  });

  test("returns solved slugs with no matching folder, sorted + de-duped", () => {
    const missing = missingSolvedSlugs(
      ["two-integer-sum"],
      ["zzz-problem", "two-sum", "aaa-problem", "aaa-problem"],
    );
    expect(missing).toEqual(["aaa-problem", "zzz-problem"]);
  });

  test("comparison is case-insensitive", () => {
    expect(missingSolvedSlugs(["Two-Integer-Sum"], ["two-sum"])).toEqual([]);
  });
});

describe("submissionPath", () => {
  test("builds the NeetCode layout with the right extension", () => {
    expect(submissionPath("two-sum", "cpp")).toBe(
      `${NEETCODE_TOPIC_DIR}/two-sum/submission-0.cpp`,
    );
    expect(submissionPath("is-subsequence", "python3")).toBe(
      `${NEETCODE_TOPIC_DIR}/is-subsequence/submission-0.py`,
    );
  });
});

describe("pullMissingSolutions", () => {
  const sol = (slug: string, lang = "cpp", code = "class Solution{};"): SolutionCode => ({
    slug,
    submissionId: "1",
    lang,
    code,
    accepted: true,
    timestamp: 1,
  });

  test("writes each fetched solution and reports what happened", async () => {
    const writes: Record<string, string> = {};
    const result = await pullMissingSolutions(["two-sum", "3sum", "boom", "no-sub"], {
      fetchSolution: async (slug) => {
        if (slug === "boom") throw new Error("network");
        if (slug === "no-sub") return null;
        return sol(slug);
      },
      write: async (path, content) => {
        writes[path] = content;
      },
    });

    expect(result.written.map((w) => w.slug)).toEqual(["two-sum", "3sum"]);
    expect(result.noSubmission).toEqual(["no-sub"]);
    expect(result.failed).toEqual([{ slug: "boom", error: "network" }]);
    expect(writes[`${NEETCODE_TOPIC_DIR}/two-sum/submission-0.cpp`]).toBe("class Solution{};\n");
  });

  test("normalizes trailing whitespace to a single newline", async () => {
    const writes: Record<string, string> = {};
    await pullMissingSolutions(["x"], {
      fetchSolution: async () => sol("x", "cpp", "code\n\n  \n"),
      write: async (path, content) => {
        writes[path] = content;
      },
    });
    expect(writes[`${NEETCODE_TOPIC_DIR}/x/submission-0.cpp`]).toBe("code\n");
  });
});
