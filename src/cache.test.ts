import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCached, isCached, putCached } from "./cache.ts";
import { repoCppPath, repoSlug } from "./repo.ts";

let dir: string;
const prevEnv = process.env.LEET_DATA_DIR;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "leet-cache-"));
  process.env.LEET_DATA_DIR = dir;
});
afterAll(async () => {
  if (prevEnv === undefined) delete process.env.LEET_DATA_DIR;
  else process.env.LEET_DATA_DIR = prevEnv;
  await rm(dir, { recursive: true, force: true });
});

describe("cache round-trip", () => {
  test("miss then hit", async () => {
    expect(await getCached("two-sum")).toBeNull();
    expect(await isCached("two-sum")).toBe(false);
    await putCached("two-sum", "// cached content\n");
    expect(await isCached("two-sum")).toBe(true);
    expect(await getCached("two-sum")).toBe("// cached content\n");
  });
});

describe("repo path/slug helpers", () => {
  test("builds the flat filename", () => {
    expect(repoCppPath(1, "two-sum")).toBe("1-two-sum.cpp");
  });
  test("default repo slug", () => {
    expect(repoSlug()).toBe("DIvkov575/leetcode-problems");
  });
});
