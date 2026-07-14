/**
 * Add the user's LeetCode-solved problems that are *missing* from their
 * NeetCode submissions repo, in that repo's own layout:
 *
 *   Data Structures & Algorithms/<slug>/submission-0.<ext>
 *
 * "Missing" is computed by mapping every existing folder through the NeetCode →
 * LeetCode alias map (adapters.ts) to its canonical LeetCode slug; any solved
 * LeetCode slug not in that set is a gap. Gaps are filled with a folder named by
 * the *LeetCode* slug (a LeetCode-only problem has no NeetCode slug), containing
 * the fetched accepted source as `submission-0.<ext>`.
 *
 * The fetch/transport is injected so the orchestration is testable without the
 * network or a real clone.
 */
import { getAdapter } from "./adapters.ts";
import { extensionForLang, type SolutionCode } from "./leetcode-submissions.ts";

/** Topic folder NeetCode's GitHub sync uses; new folders go under it too. */
export const NEETCODE_TOPIC_DIR = "Data Structures & Algorithms";

/**
 * The canonical LeetCode slug for a NeetCode folder name: the alias if one
 * exists, else the folder name itself (most already match LeetCode).
 */
export function canonicalSlug(folder: string): string {
  const key = folder.trim().toLowerCase();
  return getAdapter("neetcode").aliases[key] ?? key;
}

/**
 * Given the repo's existing folder slugs and the user's solved LeetCode slugs,
 * return the solved slugs that are NOT already represented in the repo.
 * Comparison is on canonical LeetCode slugs, so a NeetCode-renamed folder
 * (e.g. `two-integer-sum`) correctly covers its LeetCode problem (`two-sum`).
 */
export function missingSolvedSlugs(
  existingFolders: readonly string[],
  solvedSlugs: readonly string[],
): string[] {
  const covered = new Set(existingFolders.map((f) => canonicalSlug(f).toLowerCase()));
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const slug of solvedSlugs) {
    const key = slug.toLowerCase();
    if (covered.has(key) || seen.has(key)) continue;
    seen.add(key);
    missing.push(slug);
  }
  return missing.sort();
}

/** Repo-relative path for a pulled solution file. */
export function submissionPath(slug: string, lang: string): string {
  return `${NEETCODE_TOPIC_DIR}/${slug}/submission-0.${extensionForLang(lang)}`;
}

export interface PullResult {
  /** Slugs written, with the path + language used. */
  written: { slug: string; path: string; lang: string; accepted: boolean }[];
  /** Slugs solved-but-with-no-fetchable-submission (skipped). */
  noSubmission: string[];
  /** Slugs that errored during fetch (skipped, run continues). */
  failed: { slug: string; error: string }[];
}

export interface PullOptions {
  /** Fetch the best submission's code for a slug (null = nothing to pull). */
  fetchSolution: (slug: string) => Promise<SolutionCode | null>;
  /** Write one file into the repo working copy. */
  write: (path: string, content: string) => Promise<void>;
  /** Progress callback before each fetch. */
  onProgress?: (done: number, total: number, slug: string) => void;
  /** Sleep between fetches (ms) to be gentle on LeetCode; default 0 in tests. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch each missing slug's accepted source and write it as
 * `<topic>/<slug>/submission-0.<ext>`. Individual failures are recorded and
 * skipped rather than aborting the run.
 */
export async function pullMissingSolutions(
  missing: readonly string[],
  opts: PullOptions,
): Promise<PullResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const delay = opts.delayMs ?? 0;
  const result: PullResult = { written: [], noSubmission: [], failed: [] };

  let done = 0;
  for (const slug of missing) {
    done++;
    opts.onProgress?.(done, missing.length, slug);
    try {
      const sol = await opts.fetchSolution(slug);
      if (!sol) {
        result.noSubmission.push(slug);
      } else {
        const path = submissionPath(slug, sol.lang);
        // Trailing newline keeps the file tidy like NeetCode's own exports.
        await opts.write(path, sol.code.replace(/\s*$/, "") + "\n");
        result.written.push({ slug, path, lang: sol.lang, accepted: sol.accepted });
      }
    } catch (err) {
      result.failed.push({ slug, error: err instanceof Error ? err.message : String(err) });
    }
    if (delay > 0 && done < missing.length) await sleep(delay);
  }
  return result;
}
