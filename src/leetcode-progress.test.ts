import { describe, expect, test, afterEach } from "bun:test";
import { fetchSolvedSlugs } from "./leetcode-progress.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub global fetch: answer the signin check, then paginate the problem set. */
function stubProblemSet(rows: { titleSlug: string; status: string | null }[], pageSize: number) {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(body.query).includes("userStatus")) {
      return new Response(
        JSON.stringify({ data: { userStatus: { isSignedIn: true, username: "tester" } } }),
        { status: 200 },
      );
    }
    const skip = body.variables.skip as number;
    const limit = body.variables.limit as number;
    const slice = rows.slice(skip, skip + limit);
    return new Response(
      JSON.stringify({
        data: { problemsetQuestionList: { total: rows.length, questions: slice } },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return pageSize;
}

describe("fetchSolvedSlugs", () => {
  test("paginates and returns only solved (status ac) slugs", async () => {
    const rows = [
      { titleSlug: "two-sum", status: "ac" },
      { titleSlug: "add-two-numbers", status: null },
      { titleSlug: "longest-substring", status: "ac" },
      { titleSlug: "median", status: "notac" },
      { titleSlug: "zigzag", status: "ac" },
    ];
    stubProblemSet(rows, 2);
    const solved = await fetchSolvedSlugs({ session: "x" }, { pageSize: 2 });
    expect(solved).toEqual(["two-sum", "longest-substring", "zigzag"]);
  });

  test("reports progress up to the total", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ titleSlug: `p${i}`, status: "ac" }));
    stubProblemSet(rows, 2);
    const seen: Array<[number, number]> = [];
    await fetchSolvedSlugs({ session: "x" }, { pageSize: 2, onProgress: (f, t) => seen.push([f, t]) });
    expect(seen[seen.length - 1]).toEqual([5, 5]);
  });

  test("raises a clear error on 401/403", async () => {
    globalThis.fetch = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    await expect(fetchSolvedSlugs({ session: "bad" })).rejects.toThrow(/session/i);
  });

  test("expired cookie (200 but not signed in) errors instead of returning nothing", async () => {
    // LeetCode serves anonymous data for an invalid cookie: 200, userStatus not signed in.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { userStatus: { isSignedIn: false, username: "" } } }), {
        status: 200,
      })) as unknown as typeof fetch;
    await expect(fetchSolvedSlugs({ session: "expired" })).rejects.toThrow(/expired or invalid/i);
  });
});
