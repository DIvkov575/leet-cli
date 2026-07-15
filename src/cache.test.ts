import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCached, getCachedDescription, isCached, putCached } from "./cache.ts";
import { repoCppPath, repoSlug } from "./repo.ts";
import { embeddedCpp } from "./artifacts.ts";

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
  // A slug that can't be in the embedded artifact bundle, so getCached is a true
  // disk miss (the bundle only holds real bundled-list problems).
  const SYNTHETIC = "not-a-real-problem-zzz";

  test("miss then hit", async () => {
    expect(await getCached(SYNTHETIC)).toBeNull();
    expect(await isCached(SYNTHETIC)).toBe(false);
    await putCached(SYNTHETIC, "// cached content\n");
    expect(await isCached(SYNTHETIC)).toBe(true);
    expect(await getCached(SYNTHETIC)).toBe("// cached content\n");
  });
});

describe("embedded bundle fallback", () => {
  // getCached falls back to the compiled-in bundle on a disk miss, so a fresh
  // install serves problem data offline. isCached is disk-only (unchanged).
  test("getCached serves a bundled problem with no on-disk cache", async () => {
    expect(embeddedCpp("two-sum")).not.toBeNull(); // present in the bundle
    expect(await isCached("two-sum")).toBe(false); // nothing on disk
    const cpp = await getCached("two-sum");
    expect(cpp).toContain("int main()"); // came from the embedded bundle
    expect(await getCachedDescription("two-sum")).not.toBeNull();
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
