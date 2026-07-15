import { describe, expect, test, afterEach } from "bun:test";
import { fetchProblem, resetLeetCodeAuthCache } from "./leetcode.ts";

/**
 * These verify the request-shaping in graphql(): that a configured session is
 * attached as a Cookie (the fix — Premium content needs it), and that without a
 * session the request stays anonymous. `fetch` is stubbed so no network is hit.
 */
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

function stubFetch(): () => Record<string, string> {
  let captured: Record<string, string> = {};
  globalThis.fetch = (async (_url: string, init: { headers?: Record<string, string> }) => {
    captured = { ...(init?.headers ?? {}) };
    return new Response(
      JSON.stringify({
        data: {
          question: {
            questionFrontendId: "1",
            title: "Two Sum",
            titleSlug: "two-sum",
            difficulty: "Easy",
            stats: JSON.stringify({ acRate: "50%" }),
            content: "<p>x</p>",
            codeSnippets: [],
            metaData: "{}",
            exampleTestcases: "",
            isPaidOnly: false,
            categoryTitle: "Algorithms",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return () => captured;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
  resetLeetCodeAuthCache();
});

describe("fetchProblem auth cookie", () => {
  test("attaches the session cookie + csrf when configured (env)", async () => {
    process.env.LEETCODE_SESSION = "sess-abc";
    process.env.LEETCODE_CSRF = "csrf-xyz";
    // A fresh data dir with no config file, so only the env vars supply auth.
    process.env.LEET_DATA_DIR = "/tmp/leet-auth-test-" + Math.floor(performance.now());
    resetLeetCodeAuthCache();
    const headers = stubFetch();
    await fetchProblem("two-sum", { withContent: true });
    const h = headers();
    expect(h.Cookie).toContain("LEETCODE_SESSION=sess-abc");
    expect(h.Cookie).toContain("csrftoken=csrf-xyz");
    expect(h["x-csrftoken"]).toBe("csrf-xyz");
  });

  test("stays anonymous when no session is configured", async () => {
    delete process.env.LEETCODE_SESSION;
    delete process.env.LEETCODE_CSRF;
    process.env.LEET_DATA_DIR = "/tmp/leet-auth-test-none-" + Math.floor(performance.now());
    resetLeetCodeAuthCache();
    const headers = stubFetch();
    await fetchProblem("two-sum");
    const h = headers();
    expect(h.Cookie).toBeUndefined();
    expect(h["x-csrftoken"]).toBeUndefined();
    // Still sends the browser-ish UA so LeetCode doesn't 403.
    expect(h["User-Agent"]).toContain("Mozilla");
  });
});
