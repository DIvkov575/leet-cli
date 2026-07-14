/**
 * NeetCode pattern tags for problems.
 *
 * NeetCode groups every curated problem under exactly one *pattern* (e.g.
 * "Arrays & Hashing", "Two Pointers", "Graphs"). That grouping is the source of
 * truth and covers ~62% of the bundled problems. For the rest, we infer the
 * most likely pattern from LeetCode's official topic tags via `TOPIC_TO_PATTERN`
 * — a table derived empirically from the problems NeetCode *does* categorize
 * (validated at ~67% exact / ~75% family-level accuracy). Inferred tags are
 * marked `patternSource: "derived"` so callers can tell them from exact ones.
 */
import type { PatternSource } from "./types.ts";

/** The 18 canonical NeetCode patterns (excludes the JavaScript track). */
export const NEETCODE_PATTERNS = [
  "Arrays & Hashing",
  "Two Pointers",
  "Sliding Window",
  "Stack",
  "Binary Search",
  "Linked List",
  "Trees",
  "Tries",
  "Heap / Priority Queue",
  "Backtracking",
  "Graphs",
  "Advanced Graphs",
  "1-D Dynamic Programming",
  "2-D Dynamic Programming",
  "Greedy",
  "Intervals",
  "Math & Geometry",
  "Bit Manipulation",
] as const;

/**
 * LeetCode topic slug → NeetCode pattern, ordered most-specific first. A
 * problem's pattern is the pattern of the earliest entry whose topic it carries,
 * so specific signals (e.g. `sliding-window`) win over generic ones (`array`).
 *
 * Derived from co-occurrence in NeetCode's own categorization; a handful of
 * low-sample, clearly-wrong entries are hand-corrected (marked ‡).
 */
const TOPIC_TO_PATTERN: ReadonlyArray<readonly [string, string]> = [
  ["binary-tree", "Trees"],
  ["tree", "Trees"],
  ["linked-list", "Linked List"],
  ["backtracking", "Backtracking"],
  ["sliding-window", "Sliding Window"],
  ["binary-search-tree", "Trees"],
  ["trie", "Tries"],
  ["monotonic-stack", "Stack"],
  ["union-find", "Graphs"],
  ["topological-sort", "Graphs"],
  ["stack", "Stack"],
  ["breadth-first-search", "Graphs"],
  ["graph", "Graphs"],
  ["binary-search", "Binary Search"],
  ["bit-manipulation", "Bit Manipulation"],
  ["two-pointers", "Two Pointers"],
  ["depth-first-search", "Graphs"],
  ["shortest-path", "Advanced Graphs"],
  ["minimum-spanning-tree", "Advanced Graphs"],
  ["eulerian-circuit", "Advanced Graphs"],
  ["strongly-connected-component", "Advanced Graphs"],
  ["heap-priority-queue", "Heap / Priority Queue"],
  ["quickselect", "Heap / Priority Queue"],
  ["monotonic-queue", "Sliding Window"],
  ["line-sweep", "Intervals"],
  ["segment-tree", "Intervals"],
  ["binary-indexed-tree", "Intervals"],
  ["greedy", "Greedy"],
  ["counting", "Arrays & Hashing"],
  ["hash-function", "Arrays & Hashing"],
  ["hash-table", "Arrays & Hashing"],
  ["prefix-sum", "Arrays & Hashing"],
  ["design", "Arrays & Hashing"],
  ["data-stream", "Arrays & Hashing"],
  ["number-theory", "Math & Geometry"],
  ["geometry", "Math & Geometry"], // ‡ was Heap (n=3 noise)
  ["math", "Math & Geometry"],
  ["game-theory", "2-D Dynamic Programming"],
  ["memoization", "1-D Dynamic Programming"],
  ["dynamic-programming", "1-D Dynamic Programming"],
  ["matrix", "Graphs"],
  ["doubly-linked-list", "Linked List"],
  ["merge-sort", "Linked List"],
  ["bucket-sort", "Arrays & Hashing"],
  ["radix-sort", "Arrays & Hashing"],
  ["counting-sort", "Arrays & Hashing"],
  ["enumeration", "Backtracking"],
  ["bitmask", "Backtracking"],
  ["combinatorics", "Backtracking"],
  ["string-matching", "Arrays & Hashing"], // ‡ was Trees (n=3 noise)
  ["rolling-hash", "Arrays & Hashing"],
  ["ordered-set", "Trees"], // ‡ was Stack (n=5 noise)
  ["recursion", "Trees"], // ‡ was Linked List (n=14, mixed)
  ["interactive", "Binary Search"],
  ["simulation", "Arrays & Hashing"],
  ["queue", "Arrays & Hashing"],
  ["divide-and-conquer", "Arrays & Hashing"],
  ["randomized", "Arrays & Hashing"],
  ["string", "Arrays & Hashing"],
  ["sorting", "Arrays & Hashing"],
  ["array", "Arrays & Hashing"],
];

const TOPIC_PATTERN_MAP = new Map(TOPIC_TO_PATTERN);
/** Topic slugs in priority order (most specific first). */
const TOPIC_PRIORITY = TOPIC_TO_PATTERN.map(([t]) => t);

/**
 * Infer the most likely NeetCode pattern from a problem's LeetCode topic slugs.
 * Returns null when none of the topics are known (very rare — usually SQL-only).
 */
export function derivePatternFromTopics(topics: readonly string[]): string | null {
  const set = new Set(topics);
  for (const topic of TOPIC_PRIORITY) {
    if (set.has(topic)) return TOPIC_PATTERN_MAP.get(topic)!;
  }
  return null;
}

/** A problem's resolved tags: primary pattern (+ provenance) and raw LC topics. */
export interface ResolvedTags {
  pattern: string | undefined;
  patternSource: PatternSource | undefined;
  topics: string[];
}

/**
 * Resolve a problem's tags. If NeetCode natively categorizes it (`neetcodePattern`
 * present) that pattern is authoritative; otherwise infer one from `topics`.
 * `topics` (LeetCode's official tags) are always kept as secondary tags.
 */
export function resolveTags(
  neetcodePattern: string | null | undefined,
  topics: readonly string[],
): ResolvedTags {
  const topicList = [...topics];
  if (neetcodePattern) {
    return { pattern: neetcodePattern, patternSource: "neetcode", topics: topicList };
  }
  const derived = derivePatternFromTopics(topicList);
  return {
    pattern: derived ?? undefined,
    patternSource: derived ? "derived" : undefined,
    topics: topicList,
  };
}
