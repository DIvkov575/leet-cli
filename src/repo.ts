/**
 * Read packaged solution files from the public GitHub solutions repo over plain
 * HTTPS (raw.githubusercontent.com) — no `gh` CLI or auth required, so it works
 * in a freshly-installed binary. This is the bulk source for prefetch: the repo
 * holds every synced problem's `<id>-<slug>.cpp`.
 */

/** The solutions repo, overridable via LEET_REPO. */
export function repoSlug(): string {
  return process.env.LEET_REPO ?? "DIvkov575/leetcode-problems";
}

/**
 * List the current user's GitHub repos as "owner/repo", via the authenticated
 * `gh` CLI, for the sync-repo autocomplete. Returns [] on any failure (gh not
 * installed, not logged in) so the caller degrades to a plain text field rather
 * than erroring. Capped at `limit`.
 */
export async function listUserRepos(limit = 200): Promise<string[]> {
  try {
    const proc = Bun.spawn(
      ["gh", "repo", "list", "--limit", String(limit), "--json", "nameWithOwner", "--jq", ".[].nameWithOwner"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return [];
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Branch the raw files are served from, overridable via LEET_REPO_BRANCH. */
function repoBranch(): string {
  return process.env.LEET_REPO_BRANCH ?? "main";
}

/** Repo-relative filename for a problem's packaged .cpp. */
export function repoCppPath(id: number, slug: string): string {
  return `${id}-${slug}.cpp`;
}

/** Repo-relative filename for a problem's packaged .md description. */
export function repoMdPath(id: number, slug: string): string {
  return `${id}-${slug}.md`;
}

/** Raw CDN URL for a repo-relative file. */
export function repoRawUrlFor(path: string): string {
  return `https://raw.githubusercontent.com/${repoSlug()}/${repoBranch()}/${path}`;
}

/** Raw CDN URL for a problem's packaged .cpp. */
export function repoRawUrl(id: number, slug: string): string {
  return repoRawUrlFor(repoCppPath(id, slug));
}

/**
 * GET a repo-relative file over the raw CDN, returning its text or null if it
 * isn't there (404, or empty). Throws on other errors (network, 5xx) so the
 * caller can surface them.
 */
async function fetchRepoFile(path: string, slug: string): Promise<string | null> {
  const res = await fetch(repoRawUrlFor(path), { headers: { "User-Agent": "leet-cli" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`repo fetch failed for ${slug}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return text.length > 0 ? text : null;
}

/**
 * Fetch a problem's packaged .cpp from the repo, or null if it isn't there
 * (404) — e.g. premium/SQL problems that never synced.
 */
export async function fetchFromRepo(id: number, slug: string): Promise<string | null> {
  return fetchRepoFile(repoCppPath(id, slug), slug);
}

/**
 * Fetch a problem's packaged .md description from the repo, or null if it isn't
 * there. This is how the preview and `show` avoid a live LeetCode call once the
 * problem has been synced.
 */
export async function fetchMarkdownFromRepo(id: number, slug: string): Promise<string | null> {
  return fetchRepoFile(repoMdPath(id, slug), slug);
}
