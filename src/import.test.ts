import { expect, test, describe } from "bun:test";
import { getAdapter, adapterNames } from "./adapters.ts";
import { resolveSlugs, isGitHubSource } from "./import.ts";

const neetcode = getAdapter("neetcode");

describe("neetcode adapter.solvedSlugs", () => {
  test("extracts the parent folder of submission files", () => {
    const paths = [
      "Data Structures & Algorithms/two-sum/submission-0.py",
      "Data Structures & Algorithms/two-sum/submission-1.cpp",
      "Data Structures & Algorithms/valid-parentheses/submission-0.cpp",
      "README.md",
      "Data Structures & Algorithms/group-anagrams/notes.txt",
    ];
    expect(neetcode.solvedSlugs(paths)).toEqual(["two-sum", "valid-parentheses"]);
  });

  test("dedupes across multiple submissions and sorts", () => {
    const paths = [
      "x/b-slug/submission-2.py",
      "x/a-slug/submission-0.py",
      "x/b-slug/submission-0.py",
    ];
    expect(neetcode.solvedSlugs(paths)).toEqual(["a-slug", "b-slug"]);
  });

  test("ignores files not under a folder", () => {
    expect(neetcode.solvedSlugs(["submission-0.py", "top-level.md"])).toEqual([]);
  });
});

describe("resolveSlugs against bundled lists", () => {
  test("exact slug match resolves to a bundled problem", async () => {
    const r = await resolveSlugs(["two-sum"], neetcode);
    expect(r.matched.map((p) => p.id)).toContain(1);
    expect(r.unmatched).toEqual([]);
  });

  test("alias resolves a neetcode-renamed slug", async () => {
    // "anagram-groups" is neetcode's name for LeetCode "group-anagrams" (id 49).
    const r = await resolveSlugs(["anagram-groups"], neetcode);
    expect(r.matched.map((p) => p.id)).toContain(49);
  });

  test("unknown slug is reported as unmatched, not thrown", async () => {
    const r = await resolveSlugs(["definitely-not-a-real-problem-xyz"], neetcode);
    expect(r.matched).toEqual([]);
    expect(r.unmatched).toEqual(["definitely-not-a-real-problem-xyz"]);
  });

  test("dedupes when two source slugs map to the same problem", async () => {
    const r = await resolveSlugs(["two-sum", "two-integer-sum"], neetcode);
    expect(r.matched.filter((p) => p.id === 1)).toHaveLength(1);
    expect(r.totalSolved).toBe(2);
  });
});

describe("isGitHubSource", () => {
  test("owner/repo shorthand", () => expect(isGitHubSource("DIvkov575/neetcode-x")).toBe(true));
  test("https url", () =>
    expect(isGitHubSource("https://github.com/a/b")).toBe(true));
  test("local relative path", () => expect(isGitHubSource("./some/dir")).toBe(false));
  test("local absolute path", () => expect(isGitHubSource("/home/me/repo")).toBe(false));
});

test("adapterNames includes neetcode", () => {
  expect(adapterNames()).toContain("neetcode");
});
