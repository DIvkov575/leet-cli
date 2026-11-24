/**
 * `leet push --source repo` — submit YOUR OWN solutions from a NeetCode.io
 * GitHub sync (`neetcode-submissions-*`) to LeetCode, so problems you solved on
 * NeetCode show as Accepted on LeetCode too.
 *
 * The sync stores one folder per problem with `submission-N.<ext>` files
 * (N grows with each attempt). For each folder we resolve the NeetCode slug to
 * its LeetCode slug (adapter aliases), and order the submissions newest first
 * so the caller can submit the newest and optionally fall back to older ones.
 */
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { getAdapter } from "./adapters.ts";
import { isGitHubSource } from "./import.ts";

/** File extension -> LeetCode `lang` id accepted by the submit endpoint. */
export const EXT_TO_LANG: Record<string, string> = {
  cpp: "cpp",
  cc: "cpp",
  py: "python3",
  java: "java",
  js: "javascript",
  ts: "typescript",
  go: "golang",
  rs: "rust",
  c: "c",
  cs: "csharp",
  kt: "kotlin",
  swift: "swift",
  rb: "ruby",
  scala: "scala",
  php: "php",
  dart: "dart",
};

export interface RepoSubmission {
  /** Absolute path to the file. */
  path: string;
  /** Attempt number from `submission-N`. */
  n: number;
  /** LeetCode `lang` id. */
  lang: string;
}

export interface RepoProblem {
  /** Folder name as NeetCode spells it. */
  neetcodeSlug: string;
  /** Canonical LeetCode slug (after aliases). */
  slug: string;
  /** Submissions in a LeetCode-submittable language, newest first. */
  submissions: RepoSubmission[];
}

const SUBMISSION_RE = /^submission-(\d+)\.([a-z]+)$/i;

/**
 * Walk a local NeetCode sync checkout and return one entry per problem folder
 * that holds at least one submittable submission, sorted by LeetCode slug.
 */
export async function collectRepoProblems(root: string): Promise<RepoProblem[]> {
  const aliases = getAdapter("neetcode").aliases;
  const byFolder = new Map<string, RepoProblem>();
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const entry of await readdir(cur, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const m = SUBMISSION_RE.exec(entry.name);
      if (!m) continue;
      const lang = EXT_TO_LANG[m[2]!.toLowerCase()];
      if (!lang) continue;
      const folder = relative(root, cur);
      const neetcodeSlug = folder.split("/").pop()!;
      if (!neetcodeSlug) continue;
      let pr = byFolder.get(folder);
      if (!pr) {
        pr = { neetcodeSlug, slug: aliases[neetcodeSlug] ?? neetcodeSlug, submissions: [] };
        byFolder.set(folder, pr);
      }
      pr.submissions.push({ path: full, n: Number(m[1]), lang });
    }
  }
  const out = [...byFolder.values()];
  for (const pr of out) pr.submissions.sort((a, b) => b.n - a.n);
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

/**
 * Get a local directory for `source`: a local path is used as-is; an
 * "owner/repo" (or GitHub URL) is shallow-cloned into a temp dir via `gh`
 * (handles private repos), falling back to `git clone`. Call `cleanup` after.
 */
export async function checkoutRepoSource(
  source: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  if (!isGitHubSource(source)) {
    const info = await stat(source).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`no such directory "${source}"`);
    return { dir: source, cleanup: async () => {} };
  }
  const tmp = await mkdtemp(join(tmpdir(), "leet-push-repo-"));
  const dest = join(tmp, "repo");
  const cleanup = () => rm(tmp, { recursive: true, force: true });
  const run = async (cmd: string[]) => {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    return { code, err: err.trim() };
  };
  let r = await run(["gh", "repo", "clone", source, dest, "--", "--depth", "1", "-q"]).catch(() => ({
    code: 1,
    err: "gh unavailable",
  }));
  if (r.code !== 0) {
    const url = /^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source;
    r = await run(["git", "clone", "--depth", "1", "-q", url, dest]);
  }
  if (r.code !== 0) {
    await cleanup();
    throw new Error(`could not clone ${source}: ${r.err}`);
  }
  return { dir: dest, cleanup };
}
