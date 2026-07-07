/**
 * Sync problem artifacts (description, stub+harness, test cases) into a private
 * GitHub repo. One file-set per problem, flat at the repo root.
 *
 * Flow: build the slug -> lists map from bundled lists, clone the target repo,
 * skip problems already present, fetch the rest from LeetCode with staggered
 * random delays, package into split artifacts, write, then commit and push.
 */
import { availableLists, loadList } from "./lib.ts";
import { fetchProblem } from "./leetcode.ts";
import { packageProblem, type PackageInput } from "./package.ts";

/** A problem to sync: its slug and the bundled lists it belongs to. */
export interface SyncTarget {
  slug: string;
  lists: string[];
}

/**
 * Build the de-duplicated set of problems across every bundled list (or a
 * chosen subset), each annotated with the lists it appears in. Ordered by slug
 * for deterministic runs.
 */
export async function collectTargets(listNames?: string[]): Promise<SyncTarget[]> {
  const names = listNames ?? (await availableLists());
  const bySlug = new Map<string, Set<string>>();
  for (const name of names) {
    const list = await loadList(name);
    for (const p of list.problems) {
      const set = bySlug.get(p.slug) ?? new Set<string>();
      set.add(name);
      bySlug.set(p.slug, set);
    }
  }
  return [...bySlug.entries()]
    .map(([slug, lists]) => ({ slug, lists: [...lists].sort() }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Sleep for a random duration in [minMs, maxMs] to stagger requests. */
export async function staggerDelay(
  minMs: number,
  maxMs: number,
  rand: () => number,
): Promise<void> {
  const ms = minMs + rand() * (maxMs - minMs);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SyncOptions {
  /** Skip a target if its <id>-<slug>.cpp already exists (default true). */
  skipExisting?: boolean;
  /** Min/max stagger delay between fetches, ms (default 0..2000). */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** RNG for delays; injectable for tests. Defaults to Math.random. */
  rand?: () => number;
  /** Called before each fetch for progress reporting. */
  onProgress?: (done: number, total: number, slug: string) => void;
  /** Called when a target fails; the run continues. */
  onError?: (slug: string, err: unknown) => void;
  /** Check whether a problem is already present in the repo, matched by slug. */
  exists?: (slug: string) => Promise<boolean>;
  /** Write one packaged artifact. */
  write: (filename: string, content: string) => Promise<void>;
}

export interface SyncResult {
  written: string[]; // slugs newly written
  skipped: string[]; // slugs already present
  failed: string[]; // slugs that errored
}

/**
 * Fetch + package + write each target, honoring skip-existing and staggered
 * delays. Pure w.r.t. transport/storage: fetching and I/O are the injected
 * `fetchProblem`-shaped call and `write`/`exists` callbacks.
 */
export async function syncTargets(
  targets: SyncTarget[],
  opts: SyncOptions,
): Promise<SyncResult> {
  const skipExisting = opts.skipExisting ?? true;
  const minDelay = opts.minDelayMs ?? 0;
  const maxDelay = opts.maxDelayMs ?? 2000;
  const rand = opts.rand ?? Math.random;
  const result: SyncResult = { written: [], skipped: [], failed: [] };

  let done = 0;
  for (const target of targets) {
    done++;
    // Skip before fetching so already-synced problems cost no API call.
    if (skipExisting && opts.exists && (await opts.exists(target.slug))) {
      result.skipped.push(target.slug);
      continue;
    }
    opts.onProgress?.(done, targets.length, target.slug);
    try {
      const remote = await fetchProblem(target.slug, { withSnippets: true, withContent: true });

      const input: PackageInput = {
        id: remote.id,
        title: remote.title,
        slug: remote.slug,
        difficulty: remote.difficulty,
        url: `https://leetcode.com/problems/${remote.slug}/`,
        snippets: remote.snippets ?? [],
        metaData: remote.metaData,
        exampleTestcases: remote.exampleTestcases,
        contentHtml: remote.contentHtml,
        lists: target.lists,
      };
      for (const art of packageProblem(input)) {
        await opts.write(art.filename, art.content);
      }
      result.written.push(target.slug);
    } catch (err) {
      opts.onError?.(target.slug, err);
      result.failed.push(target.slug);
    }

    // Stagger between requests (not after the last one).
    if (done < targets.length) await staggerDelay(minDelay, maxDelay, rand);
  }

  return result;
}
