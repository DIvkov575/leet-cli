/**
 * git add/commit/push for an arbitrary set of paths, returning a typed result
 * instead of throwing or logging directly — so callers across both the UI
 * layer (`src/ui/actions.ts`) and plain data-layer modules (`src/sync-clone.ts`)
 * can drive it and report the outcome their own way.
 */

/** Run a git command in `cwd`, returning { code, out }. */
async function gitInDir(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: (stdout + stderr).trim() };
}

export type PushResult =
  | { status: "not-a-repo" }
  | { status: "no-changes" }
  | { status: "commit-failed"; detail: string }
  | { status: "push-failed"; detail: string }
  | { status: "pushed" };

/**
 * git add/commit/push for the given paths. `cwdDir` anchors where the repo root
 * is discovered from (`git rev-parse --show-toplevel`) — it MUST be a directory
 * (`Bun.spawn`'s `cwd` throws ENOTDIR on a file path), so callers pass the
 * containing solutions dir even when staging a single file inside it. Never
 * throws; every outcome is a `PushResult`.
 */
export async function pushPathsToRepo(
  cwdDir: string,
  paths: string[],
  commitMessage: string,
): Promise<PushResult> {
  try {
    const root = await gitInDir(["rev-parse", "--show-toplevel"], cwdDir);
    if (root.code !== 0) return { status: "not-a-repo" };
    const cwd = root.out;
    await gitInDir(["add", "--", ...paths], cwd);
    const status = await gitInDir(["status", "--porcelain", "--", ...paths], cwd);
    if (status.out === "") return { status: "no-changes" };
    const commit = await gitInDir(["commit", "-m", commitMessage, "--", ...paths], cwd);
    if (commit.code !== 0) return { status: "commit-failed", detail: commit.out.split("\n")[0] ?? "" };
    const push = await gitInDir(["push"], cwd);
    if (push.code !== 0) return { status: "push-failed", detail: push.out.split("\n").slice(-1)[0] ?? "" };
    return { status: "pushed" };
  } catch (err) {
    return { status: "push-failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
