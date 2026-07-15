import type { Difficulty } from "./types.ts";
import { normalizeDifficulty, parseAcceptance } from "./parse.ts";
import { assertOnline } from "./net.ts";

const GRAPHQL_ENDPOINT = "https://leetcode.com/graphql";

/** Starter code snippet for one language, as returned by LeetCode. */
export interface CodeSnippet {
  lang: string;
  langSlug: string;
  code: string;
}

export interface LiveProblem {
  id: number;
  title: string;
  slug: string;
  difficulty: Difficulty;
  acceptance: number | null;
  /** Problem description as HTML (only populated when requested). */
  contentHtml?: string;
  /** Starter code snippets per language (only populated when requested). */
  snippets?: CodeSnippet[];
  /** Raw LeetCode metaData JSON (method name, param/return types); populated with snippets. */
  metaData?: string;
  /** Newline-separated example inputs; populated with snippets. */
  exampleTestcases?: string;
  /** True if the problem is LeetCode Premium (no snippets/content returned without a subscription). */
  isPaidOnly: boolean;
  /** LeetCode category, e.g. "Algorithms", "Database", "JavaScript". */
  category: string;
}

interface QuestionData {
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  stats: string;
  content: string | null;
  codeSnippets: CodeSnippet[] | null;
  metaData: string | null;
  exampleTestcases: string | null;
  isPaidOnly: boolean;
  categoryTitle: string | null;
}

const QUESTION_QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    titleSlug
    difficulty
    stats
    content
    isPaidOnly
    categoryTitle
    codeSnippets {
      lang
      langSlug
      code
    }
    metaData
    exampleTestcases
  }
}`;

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  assertOnline("fetch problem data from LeetCode");
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // LeetCode 403s requests without a browser-ish UA / referer.
      "User-Agent": "Mozilla/5.0 (compatible; leet-cli)",
      Referer: "https://leetcode.com",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`LeetCode responded ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`LeetCode GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("LeetCode returned no data");
  return json.data;
}

function acRateFromStats(stats: string): number | null {
  try {
    const parsed = JSON.parse(stats) as { acRate?: string };
    return parsed.acRate ? parseAcceptance(parsed.acRate) : null;
  } catch {
    return null;
  }
}

/** Fetch a single problem's live metadata (and optionally its description/snippets). */
export async function fetchProblem(
  slug: string,
  opts: { withContent?: boolean; withSnippets?: boolean } = {},
): Promise<LiveProblem> {
  const { question } = await graphql<{ question: QuestionData | null }>(QUESTION_QUERY, {
    titleSlug: slug,
  });
  if (!question) throw new Error(`LeetCode has no problem with slug "${slug}"`);
  return {
    id: Number(question.questionFrontendId),
    title: question.title,
    slug: question.titleSlug,
    difficulty: normalizeDifficulty(question.difficulty),
    acceptance: acRateFromStats(question.stats),
    contentHtml: opts.withContent ? question.content ?? undefined : undefined,
    snippets: opts.withSnippets ? question.codeSnippets ?? [] : undefined,
    metaData: opts.withSnippets ? question.metaData ?? undefined : undefined,
    exampleTestcases: opts.withSnippets ? question.exampleTestcases ?? undefined : undefined,
    isPaidOnly: Boolean(question.isPaidOnly),
    category: question.categoryTitle ?? "Algorithms",
  };
}

/**
 * Fetch live metadata for many slugs with bounded concurrency. Individual
 * failures are reported via `onError` and skipped rather than aborting the run.
 */
export async function fetchProblems(
  slugs: string[],
  opts: { concurrency?: number; onError?: (slug: string, err: unknown) => void } = {},
): Promise<Map<string, LiveProblem>> {
  const concurrency = opts.concurrency ?? 6;
  const results = new Map<string, LiveProblem>();
  const queue = [...slugs];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const slug = queue.shift();
      if (slug === undefined) return;
      try {
        results.set(slug, await fetchProblem(slug));
      } catch (err) {
        opts.onError?.(slug, err);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, slugs.length) }, worker));
  return results;
}
