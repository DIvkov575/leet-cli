import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSyncClone, pushToNeetRepo } from "./sync-clone.ts";

function run(args: string[], cwd: string): { code: number; out: string } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? 1, out: (proc.stdout.toString() + proc.stderr.toString()).trim() };
}

/** A bare "remote" repo with one seeded commit, addressable as a local path
 * (so tests never need network access or the `gh` CLI). */
function makeBareRemote(): { remotePath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "leet-sync-clone-remote-"));
  const bare = join(root, "bare.git");
  const seedClone = join(root, "seed");
  mkdirSync(bare);
  run(["init", "--bare"], bare);
  run(["clone", bare, seedClone], root);
  run(["config", "user.email", "test@example.com"], seedClone);
  run(["config", "user.name", "Test"], seedClone);
  run(["config", "commit.gpgsign", "false"], seedClone);
  writeFileSync(join(seedClone, "README.md"), "seed\n");
  run(["add", "-A"], seedClone);
  run(["commit", "-m", "seed"], seedClone);
  run(["push"], seedClone);
  return { remotePath: bare, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("ensureSyncClone", () => {
  test("clones fresh when the clone directory doesn't exist", async () => {
    const { remotePath, cleanup } = makeBareRemote();
    const dataRoot = mkdtempSync(join(tmpdir(), "leet-sync-clone-data-"));
    try {
      const result = await ensureSyncClone(remotePath, join(dataRoot, "sync-clone"));
      expect(run(["rev-parse", "--show-toplevel"], result.path).code).toBe(0);
      expect(Bun.file(join(result.path, "README.md")).size).toBeGreaterThan(0);
    } finally {
      cleanup();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test("pulls to catch up when the clone already exists and is valid", async () => {
    const { remotePath, cleanup } = makeBareRemote();
    const dataRoot = mkdtempSync(join(tmpdir(), "leet-sync-clone-data-"));
    try {
      const clonePath = join(dataRoot, "sync-clone");
      await ensureSyncClone(remotePath, clonePath); // first clone

      // Push a second commit directly to the bare remote via a throwaway clone.
      const otherClone = join(dataRoot, "other");
      run(["clone", remotePath, otherClone], dataRoot);
      run(["config", "user.email", "test@example.com"], otherClone);
      run(["config", "user.name", "Test"], otherClone);
      run(["config", "commit.gpgsign", "false"], otherClone);
      writeFileSync(join(otherClone, "second.txt"), "hi\n");
      run(["add", "-A"], otherClone);
      run(["commit", "-m", "second"], otherClone);
      run(["push"], otherClone);

      const result = await ensureSyncClone(remotePath, clonePath); // should pull
      expect(Bun.file(join(result.path, "second.txt")).size).toBeGreaterThan(0);
    } finally {
      cleanup();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test("re-clones when the existing directory is not a valid git repo", async () => {
    const { remotePath, cleanup } = makeBareRemote();
    const dataRoot = mkdtempSync(join(tmpdir(), "leet-sync-clone-data-"));
    try {
      const clonePath = join(dataRoot, "sync-clone");
      mkdirSync(clonePath, { recursive: true });
      writeFileSync(join(clonePath, "not-a-repo.txt"), "junk\n"); // corrupt: dir exists, no .git

      const result = await ensureSyncClone(remotePath, clonePath);
      expect(run(["rev-parse", "--show-toplevel"], result.path).code).toBe(0);
      expect(Bun.file(join(result.path, "README.md")).size).toBeGreaterThan(0);
    } finally {
      cleanup();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  // git searches *upward* for a repo, so a corrupt clone dir sitting anywhere
  // under an unrelated repo (a $HOME kept in git, say) must not be mistaken for
  // a valid clone — that would `git pull` inside the user's own checkout.
  test("re-clones a corrupt clone dir nested inside an unrelated git repo", async () => {
    const { remotePath, cleanup } = makeBareRemote();
    const dataRoot = mkdtempSync(join(tmpdir(), "leet-sync-clone-data-"));
    try {
      run(["init"], dataRoot);
      run(["config", "user.email", "test@example.com"], dataRoot);
      run(["config", "user.name", "Test"], dataRoot);
      run(["config", "commit.gpgsign", "false"], dataRoot);
      writeFileSync(join(dataRoot, "unrelated.txt"), "outer\n");
      run(["add", "-A"], dataRoot);
      run(["commit", "-m", "outer"], dataRoot);

      const clonePath = join(dataRoot, "sync-clone");
      mkdirSync(clonePath, { recursive: true });
      writeFileSync(join(clonePath, "not-a-repo.txt"), "junk\n");

      const result = await ensureSyncClone(remotePath, clonePath);
      // Cloned in its own right, not resolved up to the enclosing repo.
      expect(run(["rev-parse", "--show-prefix"], result.path).out).toBe("");
      expect(Bun.file(join(result.path, "README.md")).size).toBeGreaterThan(0);
    } finally {
      cleanup();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

describe("pushToNeetRepo", () => {
  test("returns no-repo when syncRepo is empty", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "leet-sync-clone-data-"));
    try {
      const clonePath = join(dataRoot, "sync-clone");
      const result = await pushToNeetRepo("", "two-sum", "class Solution {};\n", "solutions", clonePath);
      expect(result.status).toBe("no-repo");
      // Short-circuits before any I/O: nothing was cloned or created.
      expect(existsSync(clonePath)).toBe(false);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test("writes the solution into the NeetCode layout and pushes", async () => {
    const { remotePath, cleanup } = makeBareRemote();
    const dataRoot = mkdtempSync(join(tmpdir(), "leet-sync-clone-data-"));
    try {
      // Pre-create the clone (as a repeat push would find it) and give it a
      // commit identity, so the commit doesn't depend on — or get signed by —
      // the developer's global git config. Bun.spawn ignores runtime
      // process.env mutations, so GIT_AUTHOR_* env vars can't do this.
      const clonePath = join(dataRoot, "sync-clone");
      run(["clone", remotePath, clonePath], dataRoot);
      run(["config", "user.email", "test@example.com"], clonePath);
      run(["config", "user.name", "Test"], clonePath);
      run(["config", "commit.gpgsign", "false"], clonePath);

      const result = await pushToNeetRepo(
        remotePath,
        "two-sum",
        "class Solution {};\n",
        "solve two-sum",
        clonePath,
      );
      expect(result.status).toBe("pushed");

      const content = readFileSync(
        join(clonePath, "Data Structures & Algorithms", "two-sum", "submission-0.cpp"),
        "utf8",
      );
      expect(content).toBe("class Solution {};\n");

      // commitMessage is used verbatim — pushToNeetRepo must not template it.
      const log = run(["log", "-1", "--pretty=%s"], clonePath);
      expect(log.out).toBe("solve two-sum");
      // The solution file is in the commit, not just sitting in the worktree.
      const committed = run(["show", "--name-only", "--pretty=", "HEAD"], clonePath);
      expect(committed.out).toBe("Data Structures & Algorithms/two-sum/submission-0.cpp");
    } finally {
      cleanup();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  // ensureSyncClone throws on clone/pull failure; pushToNeetRepo must report it
  // rather than propagate, so a push failure can't take down an unrelated result.
  test("reports push-failed instead of throwing when the clone can't be created", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "leet-sync-clone-data-"));
    try {
      const result = await pushToNeetRepo(
        join(dataRoot, "does-not-exist.git"),
        "two-sum",
        "class Solution {};\n",
        "solutions",
        join(dataRoot, "sync-clone"),
      );
      expect(result.status).toBe("push-failed");
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
