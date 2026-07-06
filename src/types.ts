export type Difficulty = "Easy" | "Medium" | "Hard";

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
}

export interface ProblemList {
  /** Machine name / CLI identifier, e.g. "uber". */
  name: string;
  /** Human-readable title. */
  title: string;
  problems: Problem[];
}
