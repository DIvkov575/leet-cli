import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { availableLists, loadList } from "./lib.ts";
import type { Problem } from "./types.ts";
import { getAdapter, type ImportAdapter } from "./adapters.ts";
import { fetchSolvedSlugs, type LeetCodeAuth } from "./leetcode-progress.ts";

/**
 * Import a solved-problems source (e.g. a NeetCode GitHub sync) and resolve it
 * against the bundled lists. Sources may be a local directory/file or a GitHub
 * repo (fetched via the authenticated `gh` CLI, so private repos work too).
 */

export interface ResolveResult {
  /** Problem ids that matched a bundled list, ready to mark done. */
  matchedIds: Set<number>;
  /** Distinct matched problems, for display. */
  matched: Problem[];
  /** Source slugs (after alias) that did not match any bundled list. */
  unmatched: string[];
  /** Total distinct solved slugs the adapter reported. */
  totalSolved: number;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Resolve solved slugs to bundled problem ids: exact slug, then adapter alias,
 * then normalized-title match (slug-with-spaces vs. problem title).
 */
export async function resolveSlugs(
  solvedSlugs: string[],
  adapter: ImportAdapter,
): Promise<ResolveResult> {
  const bySlug = new Map<string, Problem>();
  const byTitle = new Map<string, Problem>();
  for (const name of await availableLists()) {
    for (const p of (await loadList(name)).problems) {
      bySlug.set(p.slug, p);
      byTitle.set(normalizeTitle(p.title), p);
    }
  }

  const matchedIds = new Set<number>();
  const matched: Problem[] = [];
  const unmatched: string[] = [];

  for (const slug of solvedSlugs) {
    const canonical = adapter.aliases[slug] ?? slug;
    const hit =
      bySlug.get(canonical) ?? byTitle.get(normalizeTitle(canonical.replace(/-/g, " ")));
    if (!hit) {
      unmatched.push(canonical);
      continue;
    }
    if (!matchedIds.has(hit.id)) {
      matchedIds.add(hit.id);
      matched.push(hit);
    }
  }

  matched.sort((a, b) => a.id - b.id);
  unmatched.sort();
  return { matchedIds, matched, unmatched, totalSolved: solvedSlugs.length };
}

/** Recursively list every file path under `dir`, relative to `dir`. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const entry of await readdir(cur, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(relative(dir, full));
    }
  }
  return out;
}

/** True when `source` looks like a GitHub reference rather than a local path. */
export function isGitHubSource(source: string): boolean {
  return (
    source.startsWith("https://github.com/") ||
    source.startsWith("git@github.com:") ||
    (/^[\w.-]+\/[\w.-]+$/.test(source) && !source.startsWith(".") && !source.startsWith("/"))
  );
}

/** Normalize any accepted GitHub form to `owner/repo`. */
function parseOwnerRepo(source: string): string {
  let s = source
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const parts = s.split("/");
  if (parts.length < 2) throw new Error(`cannot parse GitHub repo from "${source}"`);
  return `${parts[0]}/${parts[1]}`;
}

/** List file paths for a source: local dir walk, single file, or GitHub tree. */
export async function listSourcePaths(source: string, ref?: string): Promise<string[]> {
  if (isGitHubSource(source)) {
    return listGitHubPaths(parseOwnerRepo(source), ref);
  }
  const info = await stat(source).catch(() => null);
  if (!info) throw new Error(`no such path "${source}"`);
  if (info.isDirectory()) return walk(source);
  // Single file: treat its own path as the only entry (relative basename kept).
  return [source.split("/").pop() ?? source];
}

/** Fetch the recursive git tree from GitHub via the authenticated `gh` CLI. */
async function listGitHubPaths(ownerRepo: string, ref?: string): Promise<string[]> {
  const sha = ref ?? (await defaultBranch(ownerRepo));
  const proc = Bun.spawn(
    ["gh", "api", `repos/${ownerRepo}/git/trees/${sha}?recursive=1`],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`gh api failed for ${ownerRepo}: ${err.trim() || `exit ${code}`}`);
  }
  const data = JSON.parse(out) as { tree?: { type: string; path: string }[]; truncated?: boolean };
  if (data.truncated) {
    console.error("warning: GitHub tree was truncated; some solved problems may be missing.");
  }
  return (data.tree ?? []).filter((t) => t.type === "blob").map((t) => t.path);
}

async function defaultBranch(ownerRepo: string): Promise<string> {
  const proc = Bun.spawn(["gh", "api", `repos/${ownerRepo}`, "--jq", ".default_branch"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const branch = out.trim();
  if (code !== 0 || !branch) return "HEAD";
  return branch;
}

/** End-to-end: acquire source paths, run the adapter, resolve against bundled. */
export async function importSource(
  source: string,
  opts: {
    adapter?: string;
    ref?: string;
    /** LeetCode session auth; required by the `leetcode` adapter. */
    auth?: LeetCodeAuth;
    onProgress?: (fetched: number, total: number) => void;
  } = {},
): Promise<ResolveResult> {
  const adapterName = opts.adapter ?? "neetcode";
  const adapter = getAdapter(adapterName);

  // The LeetCode adapter fetches your solved slugs over the authenticated API
  // instead of reading file paths from a source.
  if (adapterName === "leetcode") {
    if (!opts.auth) {
      throw new Error(
        "leetcode adapter needs a session: set LEETCODE_SESSION (and optionally LEETCODE_CSRF), or leetcodeSession in config.json",
      );
    }
    const solved = await fetchSolvedSlugs(opts.auth, { onProgress: opts.onProgress });
    return resolveSlugs(solved, adapter);
  }

  const paths = await listSourcePaths(source, opts.ref);
  const solved = adapter.solvedSlugs(paths);
  return resolveSlugs(solved, adapter);
}
