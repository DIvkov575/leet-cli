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

/** Branch the raw files are served from, overridable via LEET_REPO_BRANCH. */
function repoBranch(): string {
  return process.env.LEET_REPO_BRANCH ?? "main";
}

/** Repo-relative filename for a problem's packaged .cpp. */
export function repoCppPath(id: number, slug: string): string {
  return `${id}-${slug}.cpp`;
}

/** Raw CDN URL for a problem's packaged .cpp. */
export function repoRawUrl(id: number, slug: string): string {
  return `https://raw.githubusercontent.com/${repoSlug()}/${repoBranch()}/${repoCppPath(id, slug)}`;
}

/**
 * Fetch a problem's packaged .cpp from the repo, or null if it isn't there
 * (404) — e.g. premium/SQL problems that never synced. Throws on other errors
 * (network, 5xx) so the caller can surface them.
 */
export async function fetchFromRepo(id: number, slug: string): Promise<string | null> {
  const url = repoRawUrl(id, slug);
  const res = await fetch(url, { headers: { "User-Agent": "leet-cli" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`repo fetch failed for ${slug}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return text.length > 0 ? text : null;
}
