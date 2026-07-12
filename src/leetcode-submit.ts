/**
 * Submit a solution to LeetCode on behalf of the authenticated user and poll
 * for the judge verdict. This WRITES to the user's account (a real submission),
 * so callers gate it behind explicit confirmation and rate-limit between calls.
 *
 * Flow: POST /problems/<slug>/submit/ -> {submission_id}; then poll
 * GET /submissions/detail/<id>/check/ until state == "SUCCESS".
 * Requires the session cookie AND a CSRF token (POSTs are CSRF-protected).
 */
import type { LeetCodeAuth } from "./leetcode-progress.ts";

const BASE = "https://leetcode.com";
const QUESTION_ID_QUERY = `query q($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId } }`;

export interface SubmitVerdict {
  /** LeetCode status message: "Accepted", "Wrong Answer", "Time Limit Exceeded", … */
  statusMsg: string;
  accepted: boolean;
  submissionId: string;
  /** Passed / total test cases, when reported. */
  passed?: number;
  total?: number;
  /** Error/runtime detail when not accepted. */
  detail?: string;
}

function authHeaders(auth: LeetCodeAuth, slug: string): Record<string, string> {
  if (!auth.csrf) {
    throw new Error(
      "submitting needs a CSRF token (LEETCODE_CSRF or the csrftoken cookie). Re-run `leet auth` from a browser where you're logged in.",
    );
  }
  const cookie = `LEETCODE_SESSION=${auth.session}; csrftoken=${auth.csrf}`;
  return {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; leet-cli)",
    Cookie: cookie,
    "x-csrftoken": auth.csrf,
    Referer: `${BASE}/problems/${slug}/`,
    Origin: BASE,
  };
}

/** Look up the backend questionId the submit endpoint requires. */
async function questionId(auth: LeetCodeAuth, slug: string): Promise<string> {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: authHeaders(auth, slug),
    body: JSON.stringify({ query: QUESTION_ID_QUERY, variables: { titleSlug: slug } }),
  });
  if (!res.ok) throw new Error(`could not resolve question id for ${slug} (${res.status})`);
  const json = (await res.json()) as { data?: { question?: { questionId: string } } };
  const id = json.data?.question?.questionId;
  if (!id) throw new Error(`no such problem "${slug}"`);
  return id;
}

export interface SubmitOptions {
  lang?: string; // LeetCode lang slug, e.g. "cpp"
  /** Poll timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Sleep between polls in ms (default 1.5s). */
  pollMs?: number;
  /** Retries when LeetCode rate-limits the submit (429/throttle). Default 6. */
  maxRetries?: number;
  /** Base backoff in ms for retries; doubles each attempt. Default 10s. */
  retryBaseMs?: number;
  /** Cap on a single backoff wait, so it stays patient without exploding. Default 60s. */
  retryMaxMs?: number;
  /** Called before a backoff sleep, so callers can report the wait. */
  onRetry?: (attempt: number, waitMs: number) => void;
  /** Injectable sleeper (tests). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse a Retry-After header (seconds or HTTP date) into ms, if present. */
function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const when = Date.parse(h);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null;
}

/**
 * Submit `code` for `slug` and wait for the judge verdict. Retries on 429 with
 * exponential backoff (honoring Retry-After); throws on auth/network errors or
 * if the judge doesn't finish within the timeout.
 */
export async function submitSolution(
  auth: LeetCodeAuth,
  slug: string,
  code: string,
  opts: SubmitOptions = {},
): Promise<SubmitVerdict> {
  const lang = opts.lang ?? "cpp";
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 6;
  const retryBaseMs = opts.retryBaseMs ?? 10_000;
  const retryMaxMs = opts.retryMaxMs ?? 60_000; // cap a single backoff wait
  const qid = await questionId(auth, slug);

  // Submit, backing off and retrying while LeetCode rate-limits us. A soft
  // rate-limit shows up as an HTML "slow down" page (200/4xx, non-JSON body)
  // rather than a clean 429, so treat unparseable bodies as retryable too.
  let submissionId = "";
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/problems/${slug}/submit/`, {
      method: "POST",
      headers: authHeaders(auth, slug),
      body: JSON.stringify({ lang, question_id: qid, typed_code: code }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("LeetCode rejected the submission (401/403) — session/CSRF expired; re-run `leet auth`");
    }

    const body = await res.text();
    let parsed: { submission_id?: number | string } | null = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null; // non-JSON → almost always a throttle/error HTML page
    }

    // 429, or a non-JSON body (soft throttle) → back off and retry.
    if (res.status === 429 || parsed === null) {
      if (attempt >= maxRetries) {
        const why = res.status === 429 ? "429" : "throttled (non-JSON response)";
        throw new Error(`LeetCode rate-limited the submission (${why}) after ${maxRetries} retries`);
      }
      const wait = retryAfterMs(res) ?? Math.min(retryMaxMs, retryBaseMs * 2 ** attempt);
      opts.onRetry?.(attempt + 1, wait);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`submit failed for ${slug}: ${res.status} ${res.statusText}`);
    submissionId = String(parsed.submission_id ?? "");
    break;
  }
  if (!submissionId) throw new Error(`submit for ${slug} returned no submission id`);

  // Poll the checker until the judge finishes.
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  const pollMs = opts.pollMs ?? 1500;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const chk = await fetch(`${BASE}/submissions/detail/${submissionId}/check/`, {
      headers: authHeaders(auth, slug),
    });
    if (!chk.ok) continue;
    let d: {
      state?: string;
      status_msg?: string;
      total_correct?: number;
      total_testcases?: number;
      runtime_error?: string;
      compile_error?: string;
    } | null = null;
    try {
      d = JSON.parse(await chk.text());
    } catch {
      continue; // transient non-JSON (throttle page); keep polling
    }
    if (d && d.state === "SUCCESS") {
      const statusMsg = d.status_msg ?? "Unknown";
      return {
        statusMsg,
        accepted: statusMsg === "Accepted",
        submissionId,
        passed: d.total_correct,
        total: d.total_testcases,
        detail: d.compile_error || d.runtime_error || undefined,
      };
    }
  }
  throw new Error(`judging timed out for ${slug} (submission ${submissionId})`);
}
