/**
 * Fetch the authenticated user's *submission source code* from LeetCode.
 *
 * LeetCode exposes this over two authenticated GraphQL calls:
 *   questionSubmissionList(questionSlug:) -> submission ids + lang + status
 *   submissionDetails(submissionId:)      -> the actual code
 *
 * We want the user's own solutions, so callers pick the latest *Accepted*
 * submission per problem (falling back to the newest overall if none are
 * accepted). This is read-only — unlike leetcode-submit.ts it never writes to
 * the account — but it still needs the session cookie (submission code is
 * private). The cookie expires, so failures surface clear errors.
 */
import type { LeetCodeAuth } from "./leetcode-progress.ts";

const GRAPHQL_ENDPOINT = "https://leetcode.com/graphql";

/** LeetCode language slug -> source-file extension (matches NeetCode's table). */
export const LANG_EXTENSION: Record<string, string> = {
  cpp: "cpp",
  java: "java",
  python: "py",
  python3: "py",
  c: "c",
  csharp: "cs",
  javascript: "js",
  typescript: "ts",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  dart: "dart",
  golang: "go",
  ruby: "rb",
  scala: "scala",
  rust: "rs",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
  mysql: "sql",
  mssql: "sql",
  oraclesql: "sql",
  postgresql: "sql",
};

/** File extension for a LeetCode lang slug, defaulting to the slug itself. */
export function extensionForLang(lang: string): string {
  return LANG_EXTENSION[lang] ?? lang;
}

/** One submission row from questionSubmissionList. */
export interface SubmissionRow {
  id: string;
  lang: string;
  statusDisplay: string;
  /** Unix seconds (as a string, as LeetCode returns it). */
  timestamp: string;
}

/** A resolved solution: the chosen submission plus its fetched source code. */
export interface SolutionCode {
  slug: string;
  submissionId: string;
  lang: string;
  code: string;
  accepted: boolean;
  timestamp: number;
}

const LIST_QUERY = `query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!) {
  questionSubmissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
    submissions { id lang statusDisplay timestamp }
  }
}`;

const DETAILS_QUERY = `query submissionDetails($id: Int!) {
  submissionDetails(submissionId: $id) { code lang { name } }
}`;

function authHeaders(auth: LeetCodeAuth): Record<string, string> {
  const cookie = `LEETCODE_SESSION=${auth.session}` + (auth.csrf ? `; csrftoken=${auth.csrf}` : "");
  return {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; leet-cli)",
    Referer: "https://leetcode.com/problemset/all/",
    Cookie: cookie,
    ...(auth.csrf ? { "x-csrftoken": auth.csrf } : {}),
  };
}

async function authedGraphql<T>(
  auth: LeetCodeAuth,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "LeetCode rejected the session (401/403) — the LEETCODE_SESSION cookie is missing, expired, or invalid",
    );
  }
  if (!res.ok) throw new Error(`LeetCode responded ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`LeetCode GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("LeetCode returned no data");
  return json.data;
}

/** List a problem's submissions (most recent first), up to `limit`. */
export async function fetchSubmissionList(
  auth: LeetCodeAuth,
  slug: string,
  limit = 20,
): Promise<SubmissionRow[]> {
  const data = await authedGraphql<{
    questionSubmissionList: { submissions: SubmissionRow[] } | null;
  }>(auth, LIST_QUERY, { offset: 0, limit, questionSlug: slug });
  return data.questionSubmissionList?.submissions ?? [];
}

/** Fetch a single submission's source code. */
export async function fetchSubmissionCode(
  auth: LeetCodeAuth,
  submissionId: string,
): Promise<{ code: string; lang: string }> {
  const data = await authedGraphql<{
    submissionDetails: { code: string; lang: { name: string } } | null;
  }>(auth, DETAILS_QUERY, { id: Number(submissionId) });
  const d = data.submissionDetails;
  if (!d) throw new Error(`no submission details for ${submissionId}`);
  return { code: d.code, lang: d.lang.name };
}

/**
 * Fetch the best submission's source for `slug`: the newest Accepted one, or —
 * if none are accepted — the newest submission of any status. Returns null when
 * the problem has no submissions at all (nothing to pull).
 */
export async function fetchBestSolution(
  auth: LeetCodeAuth,
  slug: string,
): Promise<SolutionCode | null> {
  const subs = await fetchSubmissionList(auth, slug);
  if (subs.length === 0) return null;
  // Submissions come back newest-first; prefer the first Accepted one.
  const chosen = subs.find((s) => s.statusDisplay === "Accepted") ?? subs[0]!;
  const { code, lang } = await fetchSubmissionCode(auth, chosen.id);
  return {
    slug,
    submissionId: chosen.id,
    lang: lang || chosen.lang,
    code,
    accepted: chosen.statusDisplay === "Accepted",
    timestamp: Number(chosen.timestamp) || 0,
  };
}
