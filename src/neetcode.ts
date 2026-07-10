/**
 * Fallback source for problems LeetCode won't hand us a C++ starter for
 * (chiefly Premium-locked ones): the community solutions repo
 * `neetcode-gh/leetcode`, which stores one C++ file per problem under
 * `cpp/<zero-padded-id>-<slug>.cpp`.
 *
 * We fetch the solved C++ over the raw.githubusercontent CDN (no auth, no clone)
 * and expose it so `sync` can package a `.cpp` for problems that would otherwise
 * be dropped. This yields a working solution rather than an empty stub, which is
 * the best available substitute when no official starter exists.
 */

const RAW_BASE = "https://raw.githubusercontent.com/neetcode-gh/leetcode/main";
const TREE_API = "https://api.github.com/repos/neetcode-gh/leetcode/git/trees/main?recursive=1";

interface TreeEntry {
  path: string;
  type: string;
}

/** Build a slug -> repo-path map from the recursive git tree of neetcode-gh/leetcode. */
export function cppPathsFromTree(entries: TreeEntry[]): Map<string, string> {
  const bySlug = new Map<string, string>();
  for (const e of entries) {
    if (e.type !== "blob") continue;
    const m = e.path.match(/^cpp\/\d+-(.+)\.cpp$/);
    if (m) bySlug.set(m[1]!, e.path);
  }
  return bySlug;
}

/**
 * Lazily-loaded index of every C++ solution slug -> its repo path. Fetched once
 * per process and memoized; a network failure yields an empty index (callers
 * then simply find nothing, and sync records the original LeetCode failure).
 */
let indexPromise: Promise<Map<string, string>> | null = null;

async function loadIndex(): Promise<Map<string, string>> {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    try {
      const res = await fetch(TREE_API, {
        headers: { "User-Agent": "leet-cli", Accept: "application/vnd.github+json" },
      });
      if (!res.ok) return new Map<string, string>();
      const json = (await res.json()) as { tree?: TreeEntry[] };
      return cppPathsFromTree(json.tree ?? []);
    } catch {
      return new Map<string, string>();
    }
  })();
  return indexPromise;
}

/** A C++ solution recovered from NeetCode, with provenance for the file header. */
export interface NeetcodeSolution {
  code: string;
  sourceUrl: string;
}

/**
 * Fetch the NeetCode C++ solution for a slug, or null if the repo has none (or
 * the network is unavailable). The returned code is a full solution, not a stub.
 */
export async function fetchNeetcodeCpp(slug: string): Promise<NeetcodeSolution | null> {
  const path = (await loadIndex()).get(slug);
  if (!path) return null;
  const sourceUrl = `${RAW_BASE}/${path}`;
  try {
    const res = await fetch(sourceUrl, { headers: { "User-Agent": "leet-cli" } });
    if (!res.ok) return null;
    const code = await res.text();
    return code.trim().length > 0 ? { code, sourceUrl } : null;
  } catch {
    return null;
  }
}

/** Reset the memoized index (tests only). */
export function resetNeetcodeIndex(): void {
  indexPromise = null;
}
