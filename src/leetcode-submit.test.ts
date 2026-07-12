import { describe, expect, test, afterEach } from "bun:test";
import { submitSolution } from "./leetcode-submit.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const auth = { session: "s", csrf: "c" };
const noSleep = async () => {};

/** Stub the graphql questionId lookup, the submit POST, and N check polls. */
function stubSubmit(checkStates: object[]) {
  let poll = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/graphql")) {
      return new Response(JSON.stringify({ data: { question: { questionId: "42" } } }), { status: 200 });
    }
    if (url.endsWith("/submit/")) {
      return new Response(JSON.stringify({ submission_id: 999 }), { status: 200 });
    }
    if (url.includes("/check/")) {
      const body = checkStates[Math.min(poll, checkStates.length - 1)];
      poll++;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("submitSolution", () => {
  test("returns Accepted verdict once the judge finishes", async () => {
    stubSubmit([
      { state: "PENDING" },
      { state: "SUCCESS", status_msg: "Accepted", total_correct: 354, total_testcases: 354 },
    ]);
    const v = await submitSolution(auth, "regular-expression-matching", "code", { sleep: noSleep });
    expect(v.accepted).toBe(true);
    expect(v.statusMsg).toBe("Accepted");
    expect(v.passed).toBe(354);
  });

  test("reports a non-accepted verdict with detail", async () => {
    stubSubmit([
      { state: "SUCCESS", status_msg: "Wrong Answer", total_correct: 3, total_testcases: 10 },
    ]);
    const v = await submitSolution(auth, "two-sum", "code", { sleep: noSleep });
    expect(v.accepted).toBe(false);
    expect(v.statusMsg).toBe("Wrong Answer");
    expect(v.passed).toBe(3);
  });

  test("requires a CSRF token", async () => {
    await expect(submitSolution({ session: "s" }, "two-sum", "code", { sleep: noSleep })).rejects.toThrow(
      /CSRF/i,
    );
  });

  test("times out if the judge never finishes", async () => {
    stubSubmit([{ state: "PENDING" }]);
    await expect(
      submitSolution(auth, "two-sum", "code", { sleep: noSleep, timeoutMs: 5, pollMs: 1 }),
    ).rejects.toThrow(/timed out/i);
  });

  test("retries on 429 then succeeds, reporting each backoff", async () => {
    let submitCalls = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { question: { questionId: "42" } } }), { status: 200 });
      }
      if (url.endsWith("/submit/")) {
        submitCalls++;
        if (submitCalls < 3) return new Response("", { status: 429 }); // rate-limited twice
        return new Response(JSON.stringify({ submission_id: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ state: "SUCCESS", status_msg: "Accepted" }), { status: 200 });
    }) as unknown as typeof fetch;

    const backoffs: number[] = [];
    const v = await submitSolution(auth, "two-sum", "code", {
      sleep: noSleep,
      retryBaseMs: 10,
      onRetry: (_a, waitMs) => backoffs.push(waitMs),
    });
    expect(v.accepted).toBe(true);
    expect(submitCalls).toBe(3); // two 429s + one success
    expect(backoffs).toEqual([10, 20]); // exponential backoff
  });

  test("gives up after maxRetries 429s", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { question: { questionId: "42" } } }), { status: 200 });
      }
      return new Response("", { status: 429 }); // always rate-limited
    }) as unknown as typeof fetch;
    await expect(
      submitSolution(auth, "two-sum", "code", { sleep: noSleep, maxRetries: 2, retryBaseMs: 1 }),
    ).rejects.toThrow(/after 2 retries/i);
  });

  test("retries a soft throttle (non-JSON HTML body), then succeeds", async () => {
    let submitCalls = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { question: { questionId: "42" } } }), { status: 200 });
      }
      if (url.endsWith("/submit/")) {
        submitCalls++;
        // LeetCode's soft rate-limit: HTTP 200 but an HTML "slow down" page.
        if (submitCalls < 2) return new Response("<html>Too many requests</html>", { status: 200 });
        return new Response(JSON.stringify({ submission_id: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ state: "SUCCESS", status_msg: "Accepted" }), { status: 200 });
    }) as unknown as typeof fetch;

    const v = await submitSolution(auth, "two-sum", "code", { sleep: noSleep, retryBaseMs: 1 });
    expect(v.accepted).toBe(true);
    expect(submitCalls).toBe(2); // one HTML throttle + one success
  });

  test("backoff is capped by retryMaxMs so long batches stay patient, not exploding", async () => {
    let submitCalls = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { question: { questionId: "42" } } }), { status: 200 });
      }
      if (url.endsWith("/submit/")) {
        submitCalls++;
        if (submitCalls < 5) return new Response("", { status: 429 });
        return new Response(JSON.stringify({ submission_id: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ state: "SUCCESS", status_msg: "Accepted" }), { status: 200 });
    }) as unknown as typeof fetch;

    const backoffs: number[] = [];
    await submitSolution(auth, "two-sum", "code", {
      sleep: noSleep,
      retryBaseMs: 10,
      retryMaxMs: 30,
      onRetry: (_a, waitMs) => backoffs.push(waitMs),
    });
    // 10, 20, then capped at 30, 30 (would be 40, 80 uncapped).
    expect(backoffs).toEqual([10, 20, 30, 30]);
  });
});
