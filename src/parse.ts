import type { Difficulty, Problem } from "./types.ts";

/**
 * Convert a LeetCode problem title into its URL slug, matching LeetCode's own
 * scheme: lowercase, drop punctuation entirely (so "O(1)" -> "o1"), and turn
 * runs of spaces/hyphens into single hyphens.
 *
 *   "Two Sum"                 -> "two-sum"
 *   "Pow(x, n)"               -> "powx-n"
 *   "Sqrt(x)"                 -> "sqrtx"
 *   "String to Integer (atoi)" -> "string-to-integer-atoi"
 *   "All O`one Data Structure" -> "all-oone-data-structure"
 *   "Insert Delete GetRandom O(1)" -> "insert-delete-getrandom-o1"
 *   "Number of Ways to Paint N × 3 Grid" -> "number-of-ways-to-paint-n-3-grid"
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    // Delete anything that is not a letter, digit, space, or hyphen.
    .replace(/[^a-z0-9 -]+/g, "")
    // Collapse runs of spaces/hyphens into a single hyphen.
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function problemUrl(slug: string): string {
  return `https://leetcode.com/problems/${slug}/`;
}

const DIFFICULTY_MAP: Record<string, Difficulty> = {
  easy: "Easy",
  med: "Medium",
  "med.": "Medium",
  medium: "Medium",
  hard: "Hard",
};

export function normalizeDifficulty(raw: string): Difficulty {
  const key = raw.trim().toLowerCase();
  const d = DIFFICULTY_MAP[key];
  if (!d) throw new Error(`Unknown difficulty: "${raw}"`);
  return d;
}

/** Parse "57.7%" -> 57.7, "—"/""/"N/A" -> null. */
export function parseAcceptance(raw: string): number | null {
  const t = raw.trim().replace(/%$/, "");
  if (t === "" || t === "—" || t === "-" || t.toLowerCase() === "n/a") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse a leading "123. Title" line into { id, title }. */
export function parseTitleLine(line: string): { id: number; title: string } {
  const m = line.match(/^\s*(\d+)\.\s*(.+?)\s*$/);
  if (!m) throw new Error(`Not a "N. Title" line: "${line}"`);
  return { id: Number(m[1]), title: m[2]! };
}

/**
 * Parse the raw pasted LeetCode format into problems. Each problem is a block
 * of up to three non-empty lines separated by blank lines:
 *
 *   1. Two Sum
 *   57.7%
 *   Easy
 *
 * A block may omit the acceptance and/or difficulty lines (truncated paste); a
 * missing difficulty defaults to "Medium" and missing acceptance to null.
 */
export function parseRawList(raw: string): Problem[] {
  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").map((l) => l.trim()).filter((l) => l.length > 0))
    .filter((b) => b.length > 0);

  return blocks.map((lines) => {
    const { id, title } = parseTitleLine(lines[0]!);
    const slug = slugify(title);
    const acceptance = lines[1] !== undefined ? parseAcceptance(lines[1]) : null;
    const difficulty = lines[2] !== undefined ? normalizeDifficulty(lines[2]) : "Medium";
    return { id, title, slug, url: problemUrl(slug), acceptance, difficulty };
  });
}
