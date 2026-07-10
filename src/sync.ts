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
import { fetchNeetcodeCpp } from "./neetcode.ts";
import { packageProblem, packageMissing, type PackageInput } from "./package.ts";

/** A problem to sync: its slug and the bundled lists it belongs to. */
export interface SyncTarget {
  slug: string;
  lists: string[];
}

/** Why a problem could not be packaged with an official C++ starter. */
export type MissReason =
  | "premium" // LeetCode Premium: no snippets/content without a subscription
  | "sql" // Database problem: SQL only, no C++ ever
  | "javascript" // JS/TS-only problem, no C++ ever
  | "no-cpp" // has snippets but none for C++
  | "not-found" // LeetCode has no such slug
  | "fetch-error"; // network / API error

/** A problem that was not synced with an official starter, with the reason. */
export interface MissedProblem {
  slug: string;
  lists: string[];
  reason: MissReason;
  detail?: string;
  /** True when a NeetCode C++ solution was substituted instead of an official stub. */
  recoveredFromNeetcode?: boolean;
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
  /** Called when a problem is missing an official starter, after classification. */
  onMiss?: (miss: MissedProblem) => void;
  /** Check whether a problem is already present in the repo, matched by slug. */
  exists?: (slug: string) => Promise<boolean>;
  /** Write one packaged artifact. */
  write: (filename: string, content: string) => Promise<void>;
  /** LeetCode fetch; injectable for tests. Defaults to the live `fetchProblem`. */
  fetchProblem?: typeof fetchProblem;
  /**
   * Try NeetCode's community C++ repo when LeetCode has no official starter
   * (default true). Injectable for tests; defaults to the live fetch.
   */
  neetcodeFallback?: boolean;
  fetchNeetcode?: typeof fetchNeetcodeCpp;
}

export interface SyncResult {
  written: string[]; // slugs newly written with an official LeetCode starter
  recovered: string[]; // slugs written using a NeetCode C++ fallback
  skipped: string[]; // slugs already present
  /** Problems with no C++ starter (and no fallback), each with a reason. */
  missed: MissedProblem[];
}

/** Reason (and human detail) for a problem that has no usable C++ starter. */
function classifyMiss(remote: {
  isPaidOnly: boolean;
  category: string;
  snippets?: { langSlug: string }[];
}): { reason: MissReason; detail: string } {
  if (remote.isPaidOnly) {
    return { reason: "premium", detail: "LeetCode Premium — no starter code without a subscription" };
  }
  if (remote.category === "Database") {
    return { reason: "sql", detail: "Database problem — SQL only, no C++ solution exists" };
  }
  const langs = (remote.snippets ?? []).map((s) => s.langSlug);
  if (langs.length > 0 && langs.every((l) => l === "javascript" || l === "typescript")) {
    return { reason: "javascript", detail: "JavaScript/TypeScript problem — no C++ variant" };
  }
  return { reason: "no-cpp", detail: `no C++ among available languages (${langs.join(", ") || "none"})` };
}

/** True if the problem's snippets include a C++ starter. */
function hasCpp(snippets?: { langSlug: string }[]): boolean {
  return (snippets ?? []).some((s) => s.langSlug === "cpp");
}

/**
 * Fetch + package + write each target, honoring skip-existing and staggered
 * delays. Pure w.r.t. transport/storage: fetching and I/O are the injected
 * `fetchProblem`-shaped call and `write`/`exists` callbacks.
 *
 * Problems LeetCode won't give a C++ starter for are classified (premium / sql /
 * javascript / no-cpp) rather than silently dropped: for premium/no-cpp we try a
 * NeetCode C++ fallback, and whatever remains is recorded in `missed` (and a
 * placeholder .cpp + .md is written so the gap is visible in the repo).
 */
export async function syncTargets(
  targets: SyncTarget[],
  opts: SyncOptions,
): Promise<SyncResult> {
  const skipExisting = opts.skipExisting ?? true;
  const minDelay = opts.minDelayMs ?? 0;
  const maxDelay = opts.maxDelayMs ?? 2000;
  const rand = opts.rand ?? Math.random;
  const useNeetcode = opts.neetcodeFallback ?? true;
  const getNeetcode = opts.fetchNeetcode ?? fetchNeetcodeCpp;
  const doFetch = opts.fetchProblem ?? fetchProblem;
  const result: SyncResult = { written: [], recovered: [], skipped: [], missed: [] };

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
      const remote = await doFetch(target.slug, { withSnippets: true, withContent: true });
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

      if (hasCpp(remote.snippets)) {
        // Normal path: official C++ starter available.
        for (const art of packageProblem(input)) await opts.write(art.filename, art.content);
        result.written.push(target.slug);
      } else {
        // No official C++ starter — classify, then try the NeetCode fallback.
        const { reason, detail } = classifyMiss(remote);
        let recovered = false;
        // SQL/JS problems have no C++ anywhere, so don't bother the fallback.
        if (useNeetcode && (reason === "premium" || reason === "no-cpp")) {
          const nc = await getNeetcode(target.slug);
          if (nc) {
            for (const art of packageProblem(input, { neetcodeCode: nc.code, neetcodeUrl: nc.sourceUrl })) {
              await opts.write(art.filename, art.content);
            }
            result.recovered.push(target.slug);
            recovered = true;
            opts.onMiss?.({ slug: target.slug, lists: target.lists, reason, detail, recoveredFromNeetcode: true });
          }
        }
        if (!recovered) {
          // Record the gap in the repo (placeholder .cpp + .md) and in the result.
          for (const art of packageMissing(input, reason, detail)) {
            await opts.write(art.filename, art.content);
          }
          const miss: MissedProblem = { slug: target.slug, lists: target.lists, reason, detail };
          result.missed.push(miss);
          opts.onMiss?.(miss);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reason: MissReason = /has no problem with slug/.test(msg) ? "not-found" : "fetch-error";
      opts.onError?.(target.slug, err);
      const miss: MissedProblem = { slug: target.slug, lists: target.lists, reason, detail: msg };
      result.missed.push(miss);
      opts.onMiss?.(miss);
    }

    // Stagger between requests (not after the last one).
    if (done < targets.length) await staggerDelay(minDelay, maxDelay, rand);
  }

  return result;
}

/** Build the MISSING.md manifest listing every problem with no official C++ starter. */
export function missingManifest(missed: MissedProblem[]): string {
  const lines = [
    "# Missing / substituted problems",
    "",
    "Problems from the bundled lists that LeetCode does not expose a C++ starter for.",
    "Each has a placeholder `<id>-<slug>.cpp` (or a NeetCode-sourced solution where noted).",
    "",
  ];
  const labels: Record<MissReason, string> = {
    premium: "LeetCode Premium (no public starter)",
    sql: "Database / SQL-only",
    javascript: "JavaScript/TypeScript-only",
    "no-cpp": "No C++ among available languages",
    "not-found": "Not found on LeetCode",
    "fetch-error": "Fetch error",
  };
  const order: MissReason[] = ["premium", "sql", "javascript", "no-cpp", "not-found", "fetch-error"];
  for (const reason of order) {
    const group = missed.filter((m) => m.reason === reason);
    if (group.length === 0) continue;
    lines.push(`## ${labels[reason]} (${group.length})`, "");
    for (const m of group.sort((a, b) => a.slug.localeCompare(b.slug))) {
      const note = m.recoveredFromNeetcode ? " — recovered from NeetCode" : "";
      lines.push(`- \`${m.slug}\` [${m.lists.join(", ")}]${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
