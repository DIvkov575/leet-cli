import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putCached } from "./cache.ts";
import { prefetchProblems } from "./prefetch.ts";
import type { Problem } from "./types.ts";

let dir: string;
const prevEnv = process.env.LEET_DATA_DIR;

const P = (id: number, slug: string): Problem => ({
  id,
  title: slug,
  slug,
  url: `https://leetcode.com/problems/${slug}/`,
  acceptance: null,
  difficulty: "Easy",
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "leet-prefetch-"));
  process.env.LEET_DATA_DIR = dir;
});
afterAll(async () => {
  if (prevEnv === undefined) delete process.env.LEET_DATA_DIR;
  else process.env.LEET_DATA_DIR = prevEnv;
  await rm(dir, { recursive: true, force: true });
});

describe("prefetchProblems", () => {
  test("skips already-cached problems (no repo/leet calls)", async () => {
    await putCached("two-sum", "// x\n");
    await putCached("valid-anagram", "// y\n");
    const progress: string[] = [];
    const r = await prefetchProblems([P(1, "two-sum"), P(242, "valid-anagram")], {
      onProgress: (_d, _t, slug) => progress.push(slug),
    });
    expect(r).toEqual({ fromRepo: 0, fromLeet: 0, skipped: 2, failed: 0 });
    expect(progress).toEqual(["two-sum", "valid-anagram"]);
  });

  test("shouldStop halts the loop early", async () => {
    await putCached("a", "// a\n");
    await putCached("b", "// b\n");
    let count = 0;
    const r = await prefetchProblems([P(1, "a"), P(2, "b")], {
      shouldStop: () => count++ >= 1, // allow first, stop before second
    });
    expect(r.skipped).toBe(1);
  });
});
