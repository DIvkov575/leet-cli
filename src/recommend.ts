/**
 * "Recommended problems" ranking. Strategies are modular and selected by name
 * (from config), so new ranking heuristics can be added without touching the
 * UI. The default, `popularity`, ranks by how many bundled company lists a
 * problem appears in — a decent proxy for "most-asked".
 *
 * All strategies are pure: given the loaded lists and the user's completed set,
 * they return a ranked list. No I/O, so they're trivially testable.
 */
import type { Problem, ProblemList } from "./types.ts";

/** A recommended problem, carrying the signal used to rank it. */
export interface Recommendation {
  problem: Problem;
  /** Number of bundled lists this problem appears in. */
  listCount: number;
  /** Names of the lists it appears in (sorted). */
  lists: string[];
  done: boolean;
}

export interface RecommendOptions {
  /** Completed problem ids; used to flag/hide done problems. */
  completed?: Set<number>;
  /** Drop already-completed problems from the result (default false). */
  excludeDone?: boolean;
  /** Cap the number of results (default: no cap). */
  limit?: number;
}

/** A ranking strategy: lists + options -> ranked recommendations. */
export type RecommendStrategy = (lists: ProblemList[], opts: RecommendOptions) => Recommendation[];

/**
 * Drop de-selected lists from the recommendation pool. Everything downstream —
 * the popularity counts, the "appears in N lists" figure, the ranking itself —
 * is then computed as if those lists did not exist. Excluded lists remain
 * browsable in the UI; they just stop voting.
 *
 * Names are compared case-insensitively and trimmed, so a hand-edited config
 * ("Citadel", " sig ") behaves the same as one written by the TUI. Unknown
 * names are ignored rather than treated as an error: a list can disappear
 * between releases, and that shouldn't wedge anyone's settings.
 */
export function excludeLists(
  lists: ProblemList[],
  exclude: readonly string[] | undefined,
): ProblemList[] {
  if (!exclude || exclude.length === 0) return lists;
  const skip = new Set(exclude.map((n) => n.trim().toLowerCase()));
  return lists.filter((l) => !skip.has(l.name.trim().toLowerCase()));
}

/** Aggregate every problem across lists, de-duped by id, with list membership. */
function aggregate(lists: ProblemList[]): Map<number, { problem: Problem; lists: Set<string> }> {
  const byId = new Map<number, { problem: Problem; lists: Set<string> }>();
  for (const list of lists) {
    for (const p of list.problems) {
      const entry = byId.get(p.id);
      if (entry) {
        entry.lists.add(list.name);
      } else {
        byId.set(p.id, { problem: p, lists: new Set([list.name]) });
      }
    }
  }
  return byId;
}

/** Shared tail: attach done flag, optionally drop done, apply limit. */
function finish(
  ranked: { problem: Problem; lists: Set<string> }[],
  opts: RecommendOptions,
): Recommendation[] {
  const completed = opts.completed ?? new Set<number>();
  let recs = ranked.map((r) => ({
    problem: r.problem,
    listCount: r.lists.size,
    lists: [...r.lists].sort(),
    done: completed.has(r.problem.id),
  }));
  if (opts.excludeDone) recs = recs.filter((r) => !r.done);
  if (opts.limit !== undefined) recs = recs.slice(0, opts.limit);
  return recs;
}

/**
 * Popularity: most lists first; ties broken by higher acceptance (nulls last),
 * then lower id for stability.
 */
export const popularityStrategy: RecommendStrategy = (lists, opts) => {
  const entries = [...aggregate(lists).values()];
  entries.sort((a, b) => {
    if (b.lists.size !== a.lists.size) return b.lists.size - a.lists.size;
    const aa = a.problem.acceptance;
    const bb = b.problem.acceptance;
    if (aa !== bb) {
      if (aa === null) return 1;
      if (bb === null) return -1;
      return bb - aa;
    }
    return a.problem.id - b.problem.id;
  });
  return finish(entries, opts);
};

/** Acceptance: most approachable first (highest acceptance, nulls last), popularity as tiebreak. */
export const acceptanceStrategy: RecommendStrategy = (lists, opts) => {
  const entries = [...aggregate(lists).values()];
  entries.sort((a, b) => {
    const aa = a.problem.acceptance;
    const bb = b.problem.acceptance;
    if (aa !== bb) {
      if (aa === null) return 1;
      if (bb === null) return -1;
      return bb - aa;
    }
    if (b.lists.size !== a.lists.size) return b.lists.size - a.lists.size;
    return a.problem.id - b.problem.id;
  });
  return finish(entries, opts);
};

export const RECOMMEND_STRATEGIES: Record<string, RecommendStrategy> = {
  popularity: popularityStrategy,
  acceptance: acceptanceStrategy,
};

export const DEFAULT_STRATEGY = "popularity";

/** Look up a strategy by name, falling back to the default for unknown names. */
export function getStrategy(name: string | undefined): RecommendStrategy {
  return (name && RECOMMEND_STRATEGIES[name]) || RECOMMEND_STRATEGIES[DEFAULT_STRATEGY]!;
}

/** Convenience: rank with the named strategy (or default). */
export function recommendProblems(
  lists: ProblemList[],
  name: string | undefined,
  opts: RecommendOptions = {},
): Recommendation[] {
  return getStrategy(name)(lists, opts);
}
