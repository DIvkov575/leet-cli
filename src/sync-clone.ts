/**
 * A persistent local clone of the user's configured `syncRepo`, reused across
 * every `u`-triggered push instead of cloning fresh each time. Self-healing:
 * a missing or corrupted clone directory is (re-)cloned from scratch; a valid
 * one is `git pull`ed to catch up before use.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./config.ts";

/** Default location for the persistent clone; overridable for tests. */
export function syncCloneDir(): string {
  return join(dataDir(), "sync-clone");
}

/** Run `cmd` and capture combined output. Rejects only if the binary/cwd is unusable. */
async function capture(cmd: string[], cwd?: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: (stdout + stderr).trim() };
}

/**
 * Clone `repo` to `dest`. Tries `gh repo clone` first — required for a real
 * "owner/repo" GitHub reference, since it transparently handles auth for
 * private repos the way plain `git clone` can't. `gh` REJECTS anything that
 * isn't an "[HOST/]OWNER/REPO" reference rather than falling through, so a
 * local filesystem path or non-GitHub git URL needs the plain `git clone`
 * fallback below. Tests (which clone from local bare repos, so they need
 * neither network nor `gh` auth) depend on that fallback.
 */
async function cloneRepo(repo: string, dest: string): Promise<{ code: number; out: string }> {
  const viaGh = await capture(["gh", "repo", "clone", repo, dest]).catch(() => ({ code: 1, out: "" }));
  if (viaGh.code === 0) return viaGh;
  return capture(["git", "clone", repo, dest]);
}

export interface SyncCloneResult {
  /** Absolute path to the ready-to-use, up-to-date clone. */
  path: string;
}

/**
 * Ensure a local clone of `repo` exists and is up to date at `cloneDir`. If the
 * directory is missing or isn't the root of a git repo (interrupted clone, junk
 * left behind), it's removed and re-cloned; otherwise `git pull` catches it up.
 * Throws if the clone/pull itself fails (network, auth, merge conflict) —
 * callers decide how to surface that without blocking an unrelated result.
 */
export async function ensureSyncClone(
  repo: string,
  cloneDir: string = syncCloneDir(),
): Promise<SyncCloneResult> {
  // --show-prefix, not --show-toplevel: git searches *upward* for a repo, so a
  // junk cloneDir nested anywhere under an unrelated repo (a $HOME kept in git,
  // say) would look valid and we'd `git pull` inside the user's own checkout.
  // An empty prefix means cloneDir is itself the repo root.
  const probe = await capture(["git", "rev-parse", "--show-prefix"], cloneDir).catch(() => ({
    code: 1,
    out: "",
  }));

  if (probe.code !== 0 || probe.out !== "") {
    await rm(cloneDir, { recursive: true, force: true });
    const clone = await cloneRepo(repo, cloneDir);
    if (clone.code !== 0) throw new Error(`failed to clone ${repo}: ${clone.out}`);
    return { path: cloneDir };
  }

  const pull = await capture(["git", "pull"], cloneDir);
  if (pull.code !== 0) throw new Error(`failed to update local clone of ${repo}: ${pull.out}`);
  return { path: cloneDir };
}
