/**
 * Bulk-fill the local cache for a set of problems. Prefers the solutions repo
 * (fast, already packaged); falls back to a live LeetCode fetch (staggered) for
 * problems the repo doesn't have. Already-cached problems are skipped.
 */
import type { Problem } from "./types.ts";
import { isCached, putCached } from "./cache.ts";
import { fetchFromRepo } from "./repo.ts";
import { fetchProblem } from "./leetcode.ts";
import { scaffoldContent } from "./scaffold.ts";
import { staggerDelay } from "./sync.ts";

export interface PrefetchResult {
  fromRepo: number;
  fromLeet: number;
  skipped: number;
  failed: number;
}

export interface PrefetchOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  rand?: () => number;
  /** Progress callback after each problem (done count, total, current slug). */
  onProgress?: (done: number, total: number, slug: string) => void;
  /** Abort check; when it returns true, the loop stops early. */
  shouldStop?: () => boolean;
}

/** Build a packaged .cpp live from LeetCode for one problem. */
async function packageLive(slug: string): Promise<string> {
  const r = await fetchProblem(slug, { withSnippets: true, withContent: true });
  return scaffoldContent({
    id: r.id,
    title: r.title,
    slug: r.slug,
    difficulty: r.difficulty,
    url: `https://leetcode.com/problems/${r.slug}/`,
    snippets: r.snippets ?? [],
    metaData: r.metaData,
    exampleTestcases: r.exampleTestcases,
    contentHtml: r.contentHtml,
  });
}

/**
 * Prefetch each problem into the cache. Repo hits are cheap; a live fallback
 * only staggers when it actually hit LeetCode, so a fully-repo-backed run has
 * no artificial delay.
 */
export async function prefetchProblems(
  problems: Problem[],
  opts: PrefetchOptions = {},
): Promise<PrefetchResult> {
  const minDelay = opts.minDelayMs ?? 0;
  const maxDelay = opts.maxDelayMs ?? 2000;
  const rand = opts.rand ?? Math.random;
  const result: PrefetchResult = { fromRepo: 0, fromLeet: 0, skipped: 0, failed: 0 };

  let done = 0;
  for (const p of problems) {
    if (opts.shouldStop?.()) break;
    done++;
    opts.onProgress?.(done, problems.length, p.slug);

    if (await isCached(p.slug)) {
      result.skipped++;
      continue;
    }

    try {
      const fromRepo = await fetchFromRepo(p.id, p.slug);
      if (fromRepo !== null) {
        await putCached(p.slug, fromRepo);
        result.fromRepo++;
      } else {
        const live = await packageLive(p.slug);
        await putCached(p.slug, live);
        result.fromLeet++;
        // Only stagger after a real LeetCode hit.
        if (done < problems.length) await staggerDelay(minDelay, maxDelay, rand);
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}
