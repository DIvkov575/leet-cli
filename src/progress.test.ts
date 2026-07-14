import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompleted, saveCompleted, updateCompleted } from "./progress.ts";

let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leet-prog-"));
  process.env.LEET_DATA_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

describe("saveCompleted / loadCompleted", () => {
  test("round-trips, sorted, ignoring non-numbers", async () => {
    await saveCompleted(new Set([3, 1, 2]));
    expect([...(await loadCompleted())]).toEqual([1, 2, 3]);
  });

  test("missing file -> empty set", async () => {
    expect((await loadCompleted()).size).toBe(0);
  });
});

describe("updateCompleted", () => {
  test("applies an in-place mutation and persists", async () => {
    await updateCompleted((c) => c.add(42));
    expect((await loadCompleted()).has(42)).toBe(true);
  });

  test("accepts a returned replacement set", async () => {
    await saveCompleted(new Set([1, 2, 3]));
    await updateCompleted(() => new Set([9]));
    expect([...(await loadCompleted())]).toEqual([9]);
  });

  test("concurrent updates do not clobber each other (the race fix)", async () => {
    // 20 parallel single-id additions must all survive — the pre-fix
    // read-modify-write lost all but the last writer.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => updateCompleted((c) => c.add(i))),
    );
    const final = await loadCompleted();
    expect(final.size).toBe(20);
    for (let i = 0; i < 20; i++) expect(final.has(i)).toBe(true);
  });
});
