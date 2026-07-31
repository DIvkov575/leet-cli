import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSyncClone } from "./sync-clone.ts";

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
