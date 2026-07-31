import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushPathsToRepo } from "./git-push.ts";

function run(args: string[], cwd: string): { code: number; out: string } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? 1, out: (proc.stdout.toString() + proc.stderr.toString()).trim() };
}

/** A bare remote + a clone with user.email/name set, so commits succeed. */
function makeRepoPair(): { clone: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "leet-push-"));
  const bare = join(root, "bare.git");
  const clone = join(root, "clone");
  mkdirSync(bare);
  run(["init", "--bare"], bare);
  run(["clone", bare, clone], root);
  run(["config", "user.email", "test@example.com"], clone);
  run(["config", "user.name", "Test"], clone);
  return { clone, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("pushPathsToRepo", () => {
  test("not a git repo — reports not-a-repo, no throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "leet-push-norepo-"));
    try {
      const result = await pushPathsToRepo(dir, [dir], "commit msg");
      expect(result.status).toBe("not-a-repo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("nothing changed — reports no-changes", async () => {
    const { clone, cleanup } = makeRepoPair();
    try {
      writeFileSync(join(clone, "a.txt"), "hello\n");
      run(["add", "-A"], clone);
      run(["commit", "-m", "seed"], clone);
      run(["push"], clone);
      const path = join(clone, "a.txt"); // already committed, unchanged
      const result = await pushPathsToRepo(clone, [path], "no-op commit");
      expect(result.status).toBe("no-changes");
    } finally {
      cleanup();
    }
  });

  test("happy path — commits and pushes the given path", async () => {
    const { clone, cleanup } = makeRepoPair();
    try {
      writeFileSync(join(clone, "a.txt"), "hello\n");
      run(["add", "-A"], clone);
      run(["commit", "-m", "seed"], clone);
      run(["push"], clone);

      writeFileSync(join(clone, "a.txt"), "changed\n");
      const path = join(clone, "a.txt");
      const result = await pushPathsToRepo(clone, [path], "update a.txt");
      expect(result.status).toBe("pushed");
      const log = run(["log", "-1", "--pretty=%s"], clone);
      expect(log.out).toBe("update a.txt");
    } finally {
      cleanup();
    }
  });
});
