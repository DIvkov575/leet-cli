/**
 * Fetch the set of problems the *authenticated* user has solved on LeetCode.
 *
 * LeetCode's public GraphQL only exposes anonymous problem data, so "which
 * problems have I solved" requires authenticating as the user. We do that with
 * their `LEETCODE_SESSION` cookie (and CSRF token), querying the same
 * `problemsetQuestionList` endpoint the website uses, filtered to status=AC
 * (accepted). This is an unofficial endpoint and the cookie expires, so callers
 * surface clear errors rather than assuming it always works.
 */

const GRAPHQL_ENDPOINT = "https://leetcode.com/graphql";

/** Where the session cookie comes from: config field or the env var. */
export interface LeetCodeAuth {
  session: string;
  csrf?: string;
}

const SOLVED_QUERY = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total: totalNum
    questions: data {
      titleSlug
      status
    }
  }
}`;

interface QuestionRow {
  titleSlug: string;
  status: string | null; // "ac" when solved (authenticated)
}

async function authedGraphql<T>(
  auth: LeetCodeAuth,
  variables: Record<string, unknown>,
  query: string = SOLVED_QUERY,
): Promise<T> {
  const cookie = `LEETCODE_SESSION=${auth.session}` + (auth.csrf ? `; csrftoken=${auth.csrf}` : "");
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; leet-cli)",
      Referer: "https://leetcode.com/problemset/all/",
      Cookie: cookie,
      ...(auth.csrf ? { "x-csrftoken": auth.csrf } : {}),
    },
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

const SIGNIN_QUERY = `query globalData { userStatus { isSignedIn username } }`;

/**
 * Verify the session actually authenticates a user. An expired/invalid cookie
 * doesn't 401 — LeetCode just serves anonymous data (every problem status null),
 * which would otherwise look like "0 solved". Returns the username on success.
 */
export async function verifySession(auth: LeetCodeAuth): Promise<string> {
  const data = await authedGraphql<{ userStatus?: { isSignedIn: boolean; username: string } }>(
    auth,
    {},
    SIGNIN_QUERY,
  );
  if (!data.userStatus?.isSignedIn) {
    throw new Error(
      "LeetCode session is not signed in — the LEETCODE_SESSION cookie is expired or invalid",
    );
  }
  return data.userStatus.username;
}

/**
 * Return every solved (status "ac") problem's titleSlug for the authenticated
 * user, paginating through the full problem set. `onProgress` reports pages.
 * Verifies the session first so an expired cookie errors instead of quietly
 * returning nothing.
 */
export async function fetchSolvedSlugs(
  auth: LeetCodeAuth,
  opts: { pageSize?: number; onProgress?: (fetched: number, total: number) => void } = {},
): Promise<string[]> {
  await verifySession(auth);
  const limit = opts.pageSize ?? 100;
  const solved: string[] = [];
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    const data = await authedGraphql<{
      problemsetQuestionList: { total: number; questions: QuestionRow[] };
    }>(auth, { categorySlug: "", limit, skip, filters: {} });

    const page = data.problemsetQuestionList;
    total = page.total;
    for (const q of page.questions) {
      if (q.status === "ac") solved.push(q.titleSlug);
    }
    skip += page.questions.length;
    opts.onProgress?.(Math.min(skip, total), total);
    // Guard against a non-advancing page (avoids an infinite loop).
    if (page.questions.length === 0) break;
  }
  return solved;
}
