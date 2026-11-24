import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutRepoSource, collectRepoProblems } from "./push-repo.ts";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "push-repo-test-"));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await writeFile(join(root, rel), body);
  }
  return root;
}

describe("collectRepoProblems on a NeetCode sync layout", () => {
  test("aliases slugs, orders newest first numerically, maps languages, skips junk", async () => {
    const root = await fixture({
      "Data Structures & Algorithms/pow-x-n/submission-2.py": "a",
      "Data Structures & Algorithms/pow-x-n/submission-10.cpp": "b",
      "Data Structures & Algorithms/pow-x-n/submission-9.py": "c",
      "Data Structures & Algorithms/cheapest-flight-path/submission-0.cpp": "d",
      "Data Structures & Algorithms/two-sum-ish/notes.md": "x",
      "Data Structures & Algorithms/weird-lang/submission-0.zig": "x",
      ".git/objects/submission-0.py": "x",
      "README.md": "x",
    });
    try {
      const got = await collectRepoProblems(root);
      expect(got.map((p) => p.slug)).toEqual(["cheapest-flights-within-k-stops", "powx-n"]);
      const pow = got.find((p) => p.slug === "powx-n")!;
      expect(pow.neetcodeSlug).toBe("pow-x-n");
      expect(pow.submissions.map((s) => [s.n, s.lang])).toEqual([
        [10, "cpp"],
        [9, "python3"],
        [2, "python3"],
      ]);
      expect(await Bun.file(pow.submissions[0]!.path).text()).toBe("b");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("checkoutRepoSource uses a local dir in place and rejects a missing one", async () => {
    const root = await fixture({ "a/submission-0.py": "x" });
    try {
      const { dir, cleanup } = await checkoutRepoSource(root);
      expect(dir).toBe(root);
      await cleanup();
      expect(await Bun.file(join(root, "a/submission-0.py")).exists()).toBe(true);
      await expect(checkoutRepoSource(join(root, "nope"))).rejects.toThrow("no such directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
