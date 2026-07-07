/**
 * Read packaged solution files from the private GitHub solutions repo via the
 * `gh` CLI (uses the user's existing auth). This is the bulk source for
 * prefetch: the repo already holds every synced problem's `<id>-<slug>.cpp`.
 */

/** The solutions repo, overridable via LEET_REPO. */
export function repoSlug(): string {
  return process.env.LEET_REPO ?? "DIvkov575/leetcode-problems";
}

/** Repo-relative filename for a problem's packaged .cpp. */
export function repoCppPath(id: number, slug: string): string {
  return `${id}-${slug}.cpp`;
}

/**
 * Fetch a problem's packaged .cpp from the repo, or null if it isn't there
 * (404) — e.g. premium/SQL problems that never synced. Throws on other errors
 * (auth, network) so the caller can surface them.
 */
export async function fetchFromRepo(id: number, slug: string): Promise<string | null> {
  const path = repoCppPath(id, slug);
  const proc = Bun.spawn(
    ["gh", "api", `repos/${repoSlug()}/contents/${path}`, "-q", ".content"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    if (/404|Not Found/i.test(err)) return null;
    throw new Error(`gh api failed for ${path}: ${err.trim() || out.trim()}`);
  }
  // `contents` returns base64 with embedded newlines.
  const b64 = out.replace(/\s+/g, "");
  if (!b64) return null;
  return Buffer.from(b64, "base64").toString("utf8");
}
