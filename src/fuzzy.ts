/**
 * Fuzzy search over problems. A query is matched as a case-insensitive
 * subsequence against several fields — title, NeetCode pattern, LeetCode topics,
 * and company/list membership — and each problem gets a score; non-matches are
 * dropped. This replaces the old title-only substring filter with something that
 * tolerates gaps ("twosm" → "Two Sum") and searches tags/companies too.
 *
 * Pure and dependency-free, so it's unit-tested and runs identically in the CLI
 * and the TUI.
 */
import type { Problem } from "./types.ts";

/**
 * Score `query` as a subsequence of `text` (both compared lowercase). Returns
 * null if `text` doesn't contain the query's characters in order. Higher is
 * better. Rewards: a contiguous run, a match at a word boundary, and an early
 * match. A plain substring always outscores a gapped match.
 */
export function subsequenceScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;

  // Fast path: exact substring — score by earliness + a big contiguity bonus.
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const boundary = idx === 0 || /\W|_/.test(t[idx - 1] ?? " ") ? 40 : 0;
    return 1000 + boundary - idx; // substrings rank far above gapped matches
  }

  // Subsequence walk.
  let ti = 0;
  let score = 0;
  let streak = 0;
  let matched = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch) {
        found = j;
        break;
      }
    }
    if (found === -1) return null; // char not found in order → no match
    matched++;
    // Contiguity bonus (adjacent to the previous matched char).
    if (found === ti) {
      streak++;
      score += 5 + streak * 2;
    } else {
      streak = 0;
    }
    // Word-boundary bonus.
    if (found === 0 || /\W|_/.test(t[found - 1] ?? " ")) score += 10;
    // Earliness: penalise how far we skipped.
    score -= (found - ti) * 0.5;
    ti = found + 1;
  }
  // Reward matching a larger fraction of the text (tighter matches).
  score += (matched / t.length) * 5;
  return score;
}

/** One scored field, with a weight reflecting how much it should count. */
interface Field {
  text: string;
  weight: number;
}

/** How a problem's searchable fields are weighted (title matters most). */
const WEIGHTS = { title: 1, pattern: 0.6, topic: 0.5, company: 0.7 } as const;

/**
 * Score a problem against `query` across all its fields, taking the best
 * weighted field score. `companies` is the list of lists the problem belongs to
 * (its "company" tags). Returns null if nothing matches.
 */
export function scoreProblem(
  query: string,
  problem: Problem,
  companies: readonly string[] = [],
): number | null {
  const fields: Field[] = [{ text: problem.title, weight: WEIGHTS.title }];
  if (problem.pattern) fields.push({ text: problem.pattern, weight: WEIGHTS.pattern });
  for (const t of problem.topics ?? []) fields.push({ text: t, weight: WEIGHTS.topic });
  for (const c of companies) fields.push({ text: c, weight: WEIGHTS.company });
  // Also let the query match the slug (handles "two-sum" style queries).
  fields.push({ text: problem.slug, weight: WEIGHTS.title });

  let best: number | null = null;
  for (const f of fields) {
    const s = subsequenceScore(query, f.text);
    if (s === null) continue;
    const weighted = s * f.weight;
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}

/**
 * Rank `problems` by fuzzy relevance to `query`, dropping non-matches. A blank
 * query returns the input order unchanged. `companiesOf` maps a problem to the
 * lists it appears in (for company matching); omitted → no company field.
 * Ties keep the original order (stable), so equal-score problems stay by id.
 */
export function fuzzyRankProblems(
  problems: Problem[],
  query: string,
  companiesOf?: (p: Problem) => readonly string[],
): Problem[] {
  if (!query.trim()) return problems;
  const scored: Array<{ p: Problem; score: number; i: number }> = [];
  problems.forEach((p, i) => {
    const s = scoreProblem(query, p, companiesOf?.(p) ?? []);
    if (s !== null) scored.push({ p, score: s, i });
  });
  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i));
  return scored.map((x) => x.p);
}
