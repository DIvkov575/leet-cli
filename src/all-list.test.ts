import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_LIST_NAME,
  availableLists,
  browsableLists,
  loadList,
  loadAllProblems,
  saveList,
} from "./lib.ts";

// Isolate the writable lists dir so a saved list doesn't leak between tests /
// into the real user data dir.
let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leet-all-"));
  process.env.LEET_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

describe("the synthetic 'all' list", () => {
  test("browsableLists leads with 'all', then the real lists", async () => {
    const browsable = await browsableLists();
    const real = await availableLists();
    expect(browsable[0]).toBe(ALL_LIST_NAME);
    expect(browsable.slice(1)).toEqual(real);
    // 'all' is NOT one of the real, addressable lists.
    expect(real).not.toContain(ALL_LIST_NAME);
  });

  test("loadList('all') is the de-duplicated union of every list", async () => {
    const all = await loadList(ALL_LIST_NAME);
    expect(all.name).toBe(ALL_LIST_NAME);

    // Union size equals the count of distinct ids across all real lists.
    const ids = new Set<number>();
    for (const name of await availableLists()) {
      for (const p of (await loadList(name)).problems) ids.add(p.id);
    }
    expect(all.problems.length).toBe(ids.size);

    // No duplicate ids, and ordered ascending by id.
    const seen = new Set<number>();
    let prev = -1;
    for (const p of all.problems) {
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
      expect(p.id).toBeGreaterThan(prev);
      prev = p.id;
    }
  });

  test("loadAllProblems matches loadList('all')", async () => {
    const a = await loadAllProblems();
    const b = await loadList(ALL_LIST_NAME);
    expect(a.problems.map((p) => p.id)).toEqual(b.problems.map((p) => p.id));
  });

  test("the synthetic list cannot be saved", async () => {
    const all = await loadList(ALL_LIST_NAME);
    await expect(saveList(all)).rejects.toThrow(/synthetic/);
  });
});
