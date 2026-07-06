/**
 * Import adapters translate an external "solved problems" source into a list of
 * LeetCode problem slugs, which `import.ts` then resolves against the bundled
 * lists to mark problems done. Each adapter knows the layout of one source and
 * carries an alias map for sources that use non-LeetCode slugs.
 */

export interface ImportAdapter {
  readonly name: string;
  readonly description: string;
  /**
   * Given a flat list of repo-relative file paths, return the distinct LeetCode
   * slugs the source considers solved (still in the source's own slug scheme;
   * `aliases` is applied later during resolution).
   */
  solvedSlugs(paths: string[]): string[];
  /** Source-slug -> canonical-LeetCode-slug renames. */
  readonly aliases: Readonly<Record<string, string>>;
}

/**
 * NeetCode's GitHub sync (neetcode.io → `neetcode-submissions-*`) stores one
 * folder per solved problem containing `submission-N.<ext>` files, e.g.
 * `Data Structures & Algorithms/two-sum/submission-0.py`. The immediate parent
 * directory of any `submission*` file is the slug.
 *
 * NeetCode renames many problems relative to LeetCode, so `aliases` maps the
 * NeetCode slug to the canonical LeetCode slug. Entries whose target is not in
 * any bundled list are harmless — they simply never match.
 */
const NEETCODE_ALIASES: Record<string, string> = {
  // Arrays & Hashing
  "duplicate-integer": "contains-duplicate",
  "is-anagram": "valid-anagram",
  "two-integer-sum": "two-sum",
  "anagram-groups": "group-anagrams",
  "top-k-elements-in-list": "top-k-frequent-elements",
  "string-encode-and-decode": "encode-and-decode-strings",
  "products-of-array-discluding-self": "product-of-array-except-self",
  "count-squares": "detect-squares",
  // Two Pointers
  "is-palindrome": "valid-palindrome",
  "two-integer-sum-ii": "two-sum-ii-input-array-is-sorted",
  "max-water-container": "container-with-most-water",
  "buy-and-sell-crypto": "best-time-to-buy-and-sell-stock",
  // Sliding Window
  "longest-substring-without-duplicates": "longest-substring-without-repeating-characters",
  "longest-repeating-substring-with-replacement": "longest-repeating-character-replacement",
  "minimum-window-with-characters": "minimum-window-substring",
  // Stack
  "validate-parentheses": "valid-parentheses",
  "minimum-stack": "min-stack",
  // Binary Search
  "find-target-in-rotated-sorted-array": "search-in-rotated-sorted-array",
  "eating-bananas": "koko-eating-bananas",
  // Linked List
  "merge-two-sorted-linked-lists": "merge-two-sorted-lists",
  "linked-list-cycle-detection": "linked-list-cycle",
  "reorder-linked-list": "reorder-list",
  "remove-node-from-end-of-linked-list": "remove-nth-node-from-end-of-list",
  "copy-linked-list-with-random-pointer": "copy-list-with-random-pointer",
  "find-duplicate-integer": "find-the-duplicate-number",
  "merge-k-sorted-linked-lists": "merge-k-sorted-lists",
  // Trees
  "invert-a-binary-tree": "invert-binary-tree",
  "depth-of-binary-tree": "maximum-depth-of-binary-tree",
  "binary-tree-diameter": "diameter-of-binary-tree",
  "same-binary-tree": "same-tree",
  "subtree-of-a-binary-tree": "subtree-of-another-tree",
  "lowest-common-ancestor-in-binary-search-tree": "lowest-common-ancestor-of-a-binary-search-tree",
  "level-order-traversal-of-binary-tree": "binary-tree-level-order-traversal",
  "valid-binary-search-tree": "validate-binary-search-tree",
  "kth-smallest-integer-in-bst": "kth-smallest-element-in-a-bst",
  "binary-tree-from-preorder-and-inorder-traversal":
    "construct-binary-tree-from-preorder-and-inorder-traversal",
  // Tries
  "implement-prefix-tree": "implement-trie-prefix-tree",
  "design-word-search-data-structure": "design-add-and-search-words-data-structure",
  // Heap / Priority Queue
  "kth-largest-integer-in-a-stream": "kth-largest-element-in-a-stream",
  "find-median-in-a-data-stream": "find-median-from-data-stream",
  "design-twitter-feed": "design-twitter",
  // Backtracking
  "combination-target-sum": "combination-sum",
  "combination-target-sum-ii": "combination-sum-ii",
  "combinations-of-a-phone-number": "letter-combinations-of-a-phone-number",
  // Graphs
  "count-number-of-islands": "number-of-islands",
  "count-connected-components": "number-of-connected-components-in-an-undirected-graph",
  "valid-tree": "graph-valid-tree",
  "islands-and-treasure": "walls-and-gates",
  "foreign-dictionary": "alien-dictionary",
  "count-paths": "unique-paths",
  "reconstruct-flight-path": "reconstruct-itinerary",
  "min-cost-to-connect-points": "min-cost-to-connect-all-points",
  "merge-triplets-to-form-target": "merge-triplets-to-form-target-triplet",
  // Intervals
  "insert-new-interval": "insert-interval",
  "meeting-schedule": "meeting-rooms",
  "meeting-schedule-ii": "meeting-rooms-ii",
  "minimum-interval-including-query": "minimum-interval-to-include-each-query",
};

/** Slug of the immediate parent directory of any `submission*` file. */
function neetcodeSolvedSlugs(paths: string[]): string[] {
  const slugs = new Set<string>();
  for (const raw of paths) {
    const parts = raw.split("/");
    const base = parts[parts.length - 1] ?? "";
    if (parts.length >= 2 && base.toLowerCase().startsWith("submission")) {
      slugs.add(parts[parts.length - 2]!);
    }
  }
  return [...slugs].sort();
}

const ADAPTERS: Record<string, ImportAdapter> = {
  neetcode: {
    name: "neetcode",
    description: "NeetCode.io GitHub sync (folder-per-problem with submission-N files)",
    solvedSlugs: neetcodeSolvedSlugs,
    aliases: NEETCODE_ALIASES,
  },
};

export function getAdapter(name: string): ImportAdapter {
  const a = ADAPTERS[name];
  if (!a) {
    throw new Error(`unknown adapter "${name}" (available: ${Object.keys(ADAPTERS).join(", ")})`);
  }
  return a;
}

export function adapterNames(): string[] {
  return Object.keys(ADAPTERS);
}
