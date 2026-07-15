export type Difficulty = "Easy" | "Medium" | "Hard";

/** Where a problem's primary NeetCode pattern came from. */
export type PatternSource = "neetcode" | "derived";

export interface Problem {
  /** LeetCode problem number, e.g. 1 for "Two Sum". */
  id: number;
  title: string;
  /** URL slug, e.g. "two-sum". */
  slug: string;
  /** Full problem URL. */
  url: string;
  /** Acceptance rate as a percentage (0-100), or null if unknown. */
  acceptance: number | null;
  difficulty: Difficulty;
  /**
   * Primary NeetCode pattern/category, e.g. "Arrays & Hashing", "Two Pointers".
   * `pattern` is NeetCode's own tag when `patternSource` is "neetcode", or a
   * best-effort inference from LeetCode's topic tags when "derived" (~67-75%
   * accurate — the problem isn't in NeetCode's curated set). Absent if unknown.
   */
  pattern?: string;
  patternSource?: PatternSource;
  /** LeetCode's official topic tags (slugs), e.g. ["array", "hash-table"]. */
  topics?: string[];
  /**
   * NeetCode curated-set memberships this problem belongs to, any of
   * "blind75" | "neetcode150" | "neetcode250". Absent/empty if it's in none.
   */
  subsets?: string[];
}

export interface ProblemList {
  /** Machine name / CLI identifier, e.g. "uber". */
  name: string;
  /** Human-readable title. */
  title: string;
  problems: Problem[];
}
