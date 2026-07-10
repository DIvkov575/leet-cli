import { describe, expect, test, afterEach } from "bun:test";
import { repoSlug, repoCppPath, repoRawUrl } from "./repo.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("repoCppPath", () => {
  test("is <id>-<slug>.cpp", () => {
    expect(repoCppPath(1, "two-sum")).toBe("1-two-sum.cpp");
  });
});

describe("repoRawUrl", () => {
  test("builds a raw.githubusercontent.com URL for the default repo/branch", () => {
    delete process.env.LEET_REPO;
    delete process.env.LEET_REPO_BRANCH;
    expect(repoRawUrl(1, "two-sum")).toBe(
      "https://raw.githubusercontent.com/DIvkov575/leetcode-problems/main/1-two-sum.cpp",
    );
  });

  test("honors LEET_REPO and LEET_REPO_BRANCH overrides", () => {
    process.env.LEET_REPO = "me/mine";
    process.env.LEET_REPO_BRANCH = "dev";
    expect(repoSlug()).toBe("me/mine");
    expect(repoRawUrl(42, "foo")).toBe("https://raw.githubusercontent.com/me/mine/dev/42-foo.cpp");
  });
});
