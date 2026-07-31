import { describe, expect, test } from "bun:test";
import { createActions } from "./actions.ts";
import { createInputHandler } from "./input.ts";
import { recompute, logsBeginRun, logsAppendRun, type State } from "./state.ts";
import type { TuiContext } from "./context.ts";
import type { Problem } from "../types.ts";

/**
 * End-to-end coverage of the extracted input handler + action wiring, driven
 * headlessly: build a context over a fake stdout, feed key bytes to `onData`,
 * and assert the state transitions. This is the safety net for the runtime that
 * the pure render tests can't reach.
 */
function makeProblems(n: number): Problem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Problem ${i + 1}`,
    slug: `problem-${i + 1}`,
    url: "u",
    acceptance: 50,
    difficulty: "Easy" as const,
    pattern: "Arrays & Hashing",
    topics: ["array"],
  }));
}

function harness() {
  const problems = makeProblems(5);
  const state = {
    list: { name: "demo", title: "Demo", problems },
    listNames: ["demo"],
    allProblems: problems,
    listMeta: new Map([["demo", problems.map((p) => p.id)]]),
    recommended: [],
    showingRecommended: false,
    completed: new Set<number>(),
    doneFilter: "all",
    diff: undefined,
    tagFilter: new Set<string>(),
    tagPicker: null,
    filterPanel: null,
    palette: null,
    roadmap: null,
    search: "",
    sortKey: "id",
    sortDesc: false,
    filtered: [],
    cursor: 0,
    top: 0,
    listCursor: 0,
    listTop: 0,
    focus: "problems",
    lastPanel: "problems",
    menuIndex: 0,
    preview: { slug: null, status: "idle", text: "", scroll: 0 },
    logs: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: 5,
    status: "",
    input: null,
    config: null,
    sync: null,
    help: false,
    prefetch: null,
    suggestSetup: false,
    fullscreen: false,
  } as unknown as State;
  recompute(state);
  let renders = 0;
  const out = { columns: 120, rows: 40, write() {}, on() {}, removeListener() {} } as unknown as NodeJS.WriteStream;
  const ctx: TuiContext = {
    state,
    render: () => { renders++; },
    out,
    config: {},
    rankRecommended: () => [],
    onData: null,
    finish: () => {},
  };
  const actions = createActions(ctx);
  const onData = createInputHandler(ctx, actions);
  ctx.onData = onData;
  const key = (s: string) => onData(Buffer.from(s, "utf8"));
  return { state, key, renders: () => renders };
}

describe("input handler — navigation", () => {
  test("j / k move the problems cursor", () => {
    const h = harness();
    h.key("j");
    expect(h.state.cursor).toBe(1);
    h.key("k");
    expect(h.state.cursor).toBe(0);
  });
  test("G jumps to the last problem, g to the first", () => {
    const h = harness();
    h.key("G");
    expect(h.state.cursor).toBe(h.state.filtered.length - 1);
    h.key("g");
    expect(h.state.cursor).toBe(0);
  });
});

describe("input handler — Lists panel accepts contextual actions", () => {
  test("Space toggles done on the current problem from the Lists panel", async () => {
    // toggleDone() persists via saveCompleted(), which writes to LEET_DATA_DIR —
    // isolate it so this test can't touch the real user's completed.json.
    const prevDataDir = process.env.LEET_DATA_DIR;
    process.env.LEET_DATA_DIR = "/tmp/leet-lists-toggle-" + Math.floor(performance.now());
    try {
      const h = harness();
      h.state.focus = "lists";
      const p = h.state.filtered[h.state.cursor]!;
      expect(h.state.completed.has(p.id)).toBe(false);
      h.key(" ");
      await new Promise((r) => setTimeout(r, 0));
      expect(h.state.completed.has(p.id)).toBe(true);
      h.key(" ");
      await new Promise((r) => setTimeout(r, 0));
      expect(h.state.completed.has(p.id)).toBe(false);
    } finally {
      if (prevDataDir === undefined) delete process.env.LEET_DATA_DIR;
      else process.env.LEET_DATA_DIR = prevDataDir;
    }
  });

  test("o opens the current problem's URL from the Lists panel", async () => {
    const h = harness();
    h.state.focus = "lists";
    const opened: string[] = [];
    const realSpawn = Bun.spawn;
    // @ts-expect-error -- stub Bun.spawn to capture the `open`/`xdg-open` call
    Bun.spawn = (cmd: string[]) => {
      opened.push(...cmd);
      return { exited: Promise.resolve(0) };
    };
    try {
      h.key("o");
      await new Promise((r) => setTimeout(r, 0));
      expect(opened.some((c) => c === h.state.filtered[h.state.cursor]!.url)).toBe(true);
    } finally {
      Bun.spawn = realSpawn;
    }
  });
});

describe("input handler — menu bar", () => {
  test("Tab enters the menu, l/h move, Esc returns", () => {
    const h = harness();
    h.key("\t");
    expect(h.state.focus).toBe("menu");
    const m0 = h.state.menuIndex;
    h.key("l");
    expect(h.state.menuIndex).toBe(m0 + 1);
    h.key("h");
    expect(h.state.menuIndex).toBe(m0);
    h.key("\x1b");
    expect(h.state.focus).toBe("problems");
  });
});

describe("input handler — overlays", () => {
  test("T opens the tag picker; space toggles, n clears", () => {
    const h = harness();
    h.key("T");
    expect(h.state.tagPicker).not.toBeNull();
    h.key(" ");
    expect(h.state.tagFilter.size).toBe(1);
    h.key("n");
    expect(h.state.tagFilter.size).toBe(0);
  });

  test("m opens the roadmap; arrows move the cursor; Enter filters + closes", () => {
    const h = harness();
    h.key("m");
    expect(h.state.roadmap).not.toBeNull();
    h.key("\x1b[B"); // down
    expect(h.state.roadmap!.cursor).toBeGreaterThan(0);
    h.key("\r"); // study → sets tag filter, closes, focuses problems
    expect(h.state.roadmap).toBeNull();
    expect(h.state.focus).toBe("problems");
    expect(h.state.tagFilter.size).toBe(1);
  });

  test("? toggles help", () => {
    const h = harness();
    h.key("?");
    expect(h.state.help).toBe(true);
    h.key("\x1b");
    expect(h.state.help).toBe(false);
  });

  test("f opens the combined filter overlay; ←→ cycle status; x clears", () => {
    const h = harness();
    h.key("f");
    expect(h.state.filterPanel).not.toBeNull();
    expect(h.state.doneFilter).toBe("all");
    h.key("\x1b[C"); // right → cycle status forward
    expect(h.state.doneFilter).toBe("todo");
    h.key("\x1b[D"); // left → back to all
    expect(h.state.doneFilter).toBe("all");
    h.key("\x1b[B"); // down to Difficulty row
    h.key("\x1b[C"); // right → Easy
    expect(h.state.diff).toBe("Easy");
    h.key("x"); // clear everything
    expect(h.state.diff).toBeUndefined();
    expect(h.state.doneFilter).toBe("all");
    h.key("\x1b"); // close
    expect(h.state.filterPanel).toBeNull();
  });

  test("filter overlay: Tags row opens the tag picker", () => {
    const h = harness();
    h.key("f");
    h.key("\x1b[B"); // Difficulty
    h.key("\x1b[B"); // Sort
    h.key("\x1b[B"); // Tags
    h.key(" "); // activate → opens tag picker
    expect(h.state.filterPanel).toBeNull();
    expect(h.state.tagPicker).not.toBeNull();
  });

  test("menu bar → Menu opens the command palette; Enter fires an action", () => {
    const h = harness();
    h.key("\t"); // enter menu bar (index 0 = Search)
    h.key("l"); // Filter
    h.key("l"); // Roadmap
    h.key("l"); // Menu
    expect(h.state.menuIndex).toBe(3);
    h.key("\r"); // activate Menu → palette
    expect(h.state.palette).not.toBeNull();
    h.key("\x1b"); // close
    expect(h.state.palette).toBeNull();
  });

  test("u submits to LeetCode; without a session it reports that in Logs", async () => {
    const prevDir = process.env.LEET_DATA_DIR;
    const prevSession = process.env.LEETCODE_SESSION;
    // Point config at an empty dir and clear any exported session so the submit
    // path takes the deterministic, network-free "not authenticated" branch.
    process.env.LEET_DATA_DIR = "/tmp/leet-submit-noauth-" + Math.floor(performance.now());
    delete process.env.LEETCODE_SESSION;
    try {
      const h = harness();
      h.key("u");
      // submitCurrent awaits loadConfig() first; flush microtasks.
      await new Promise((r) => setTimeout(r, 0));
      expect(h.state.focus).toBe("logs");
      expect(h.state.logs.status).toBe("done");
      expect(h.state.logs.lines.join(" ")).toMatch(/authenticate/i);
      expect(h.state.logs.ok).toBe(false);
    } finally {
      if (prevDir === undefined) delete process.env.LEET_DATA_DIR;
      else process.env.LEET_DATA_DIR = prevDir;
      if (prevSession !== undefined) process.env.LEETCODE_SESSION = prevSession;
    }
  });

  test("u, once Accepted, commits + pushes the solution file to the repo it lives in", async () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const run = (args: string[], cwd: string) => {
      const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
      return (proc.stdout.toString() + proc.stderr.toString()).trim();
    };

    const root = mkdtempSync(join(tmpdir(), "leet-submit-push-"));
    const bare = join(root, "bare.git");
    const solutionsDir = join(root, "solutions");
    mkdirSync(bare);
    run(["init", "--bare"], bare);
    run(["clone", bare, solutionsDir], root);
    run(["config", "user.email", "test@example.com"], solutionsDir);
    run(["config", "user.name", "Test"], solutionsDir);
    // The real user's global config may enable commit signing; a throwaway repo
    // has no business needing a signing key, and requiring one would make this
    // test fail on machines where the key isn't available.
    run(["config", "commit.gpgsign", "false"], solutionsDir);
    // Seed an initial commit so the clone has a remote-tracking branch to push against.
    writeFileSync(join(solutionsDir, ".gitkeep"), "");
    run(["add", "-A"], solutionsDir);
    run(["commit", "-m", "seed"], solutionsDir);
    run(["push"], solutionsDir);
    // Guard the fixture itself, so a broken setup can't look like a broken feature.
    expect(run(["rev-parse", "--abbrev-ref", "@{upstream}"], solutionsDir)).toContain("origin/");

    // problem-1 in the harness has id 1, slug "problem-1" — write its solution file.
    writeFileSync(join(solutionsDir, "1-problem-1.cpp"), "class Solution {};\n");

    const prevDataDir = process.env.LEET_DATA_DIR;
    const prevSession = process.env.LEETCODE_SESSION;
    const prevCsrf = process.env.LEETCODE_CSRF;
    process.env.LEET_DATA_DIR = mkdtempSync(join(tmpdir(), "leet-data-"));
    process.env.LEETCODE_SESSION = "s";
    process.env.LEETCODE_CSRF = "c";

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { question: { questionId: "1" } } }), { status: 200 });
      }
      if (url.endsWith("/submit/")) {
        return new Response(JSON.stringify({ submission_id: 1 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ state: "SUCCESS", status_msg: "Accepted", total_correct: 1, total_testcases: 1 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const h = harness();
      // Point the harness's resolved solutionsDir at our temp repo via config.json.
      writeFileSync(
        join(process.env.LEET_DATA_DIR, "config.json"),
        JSON.stringify({ solutionsDir, leetcodeSession: "s", leetcodeCsrf: "c" }),
      );
      h.key("u");
      // Wait for the async submit + push chain to settle. `submitSolution` sleeps
      // `pollMs` (1.5s) before its first verdict poll and `submitCurrent` doesn't
      // override it, so poll for the terminal state rather than guessing a delay.
      const deadline = Date.now() + 15_000;
      while (h.state.logs.status !== "done" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(h.state.logs.status).toBe("done");
      expect(h.state.logs.ok).toBe(true);
      expect(h.state.logs.lines.join(" ")).toMatch(/pushed/i);
      const log = run(["log", "-1", "--pretty=%s"], solutionsDir);
      expect(log).toContain("1-problem-1");
    } finally {
      globalThis.fetch = realFetch;
      if (prevDataDir === undefined) delete process.env.LEET_DATA_DIR;
      else process.env.LEET_DATA_DIR = prevDataDir;
      if (prevSession === undefined) delete process.env.LEETCODE_SESSION;
      else process.env.LEETCODE_SESSION = prevSession;
      if (prevCsrf === undefined) delete process.env.LEETCODE_CSRF;
      else process.env.LEETCODE_CSRF = prevCsrf;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("u, once Accepted, also pushes the solution into the configured neet-layout repo", async () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const run = (args: string[], cwd: string) => {
      const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
      return (proc.stdout.toString() + proc.stderr.toString()).trim();
    };

    const root = mkdtempSync(join(tmpdir(), "leet-submit-neet-"));

    // Flat "gh" solutions repo (same setup as the sibling test).
    const ghBare = join(root, "gh-bare.git");
    const solutionsDir = join(root, "solutions");
    mkdirSync(ghBare);
    run(["init", "--bare"], ghBare);
    run(["clone", ghBare, solutionsDir], root);
    run(["config", "user.email", "test@example.com"], solutionsDir);
    run(["config", "user.name", "Test"], solutionsDir);
    run(["config", "commit.gpgsign", "false"], solutionsDir);
    writeFileSync(join(solutionsDir, ".gitkeep"), "");
    run(["add", "-A"], solutionsDir);
    run(["commit", "-m", "seed"], solutionsDir);
    run(["push"], solutionsDir);
    writeFileSync(join(solutionsDir, "1-problem-1.cpp"), "class Solution {};\n");

    // Separate "neet" bare remote — a distinct repo from the gh one above.
    // Pre-clone it into the location pushToNeetRepo's default cloneDir will
    // use (<LEET_DATA_DIR>/sync-clone), with a commit identity set directly on
    // the clone — Bun.spawn does not see process.env mutations made at test
    // runtime, so GIT_AUTHOR_*/user.email must be set via `git config` on the
    // repo itself, not via process.env.
    const neetBare = join(root, "neet-bare.git");
    mkdirSync(neetBare);
    run(["init", "--bare"], neetBare);

    const prevDataDir = process.env.LEET_DATA_DIR;
    const prevSession = process.env.LEETCODE_SESSION;
    const prevCsrf = process.env.LEETCODE_CSRF;
    const prevSyncRepo = process.env.LEET_SYNC_REPO;
    const dataDirPath = mkdtempSync(join(tmpdir(), "leet-data-"));
    process.env.LEET_DATA_DIR = dataDirPath;
    process.env.LEETCODE_SESSION = "s";
    process.env.LEETCODE_CSRF = "c";
    // $LEET_SYNC_REPO outranks config.json in resolveSyncRepo, so a developer
    // who exports it would otherwise have this test push to their real remote.
    delete process.env.LEET_SYNC_REPO;

    const neetClone = join(dataDirPath, "sync-clone");
    run(["clone", neetBare, neetClone], root);
    run(["config", "user.email", "test@example.com"], neetClone);
    run(["config", "user.name", "Test"], neetClone);
    run(["config", "commit.gpgsign", "false"], neetClone);
    writeFileSync(join(neetClone, "README.md"), "seed\n");
    run(["add", "-A"], neetClone);
    run(["commit", "-m", "seed"], neetClone);
    run(["push"], neetClone);

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { question: { questionId: "1" } } }), { status: 200 });
      }
      if (url.endsWith("/submit/")) {
        return new Response(JSON.stringify({ submission_id: 1 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ state: "SUCCESS", status_msg: "Accepted", total_correct: 1, total_testcases: 1 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const h = harness();
      writeFileSync(
        join(dataDirPath, "config.json"),
        JSON.stringify({
          solutionsDir,
          leetcodeSession: "s",
          leetcodeCsrf: "c",
          syncRepo: neetBare, // a local bare-repo path stands in for "owner/repo" in this test
        }),
      );
      h.key("u");
      const deadline = Date.now() + 15_000;
      while (h.state.logs.status !== "done" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(h.state.logs.status).toBe("done");
      expect(h.state.logs.ok).toBe(true);

      const written = readFileSync(
        join(neetClone, "Data Structures & Algorithms", "problem-1", "submission-0.cpp"),
        "utf8",
      );
      expect(written).toBe("class Solution {};\n");
    } finally {
      globalThis.fetch = realFetch;
      if (prevDataDir === undefined) delete process.env.LEET_DATA_DIR;
      else process.env.LEET_DATA_DIR = prevDataDir;
      if (prevSession === undefined) delete process.env.LEETCODE_SESSION;
      else process.env.LEETCODE_SESSION = prevSession;
      if (prevCsrf === undefined) delete process.env.LEETCODE_CSRF;
      else process.env.LEETCODE_CSRF = prevCsrf;
      if (prevSyncRepo === undefined) delete process.env.LEET_SYNC_REPO;
      else process.env.LEET_SYNC_REPO = prevSyncRepo;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("y opens the Sync overlay directly, from any panel", () => {
    const h = harness();
    expect(h.state.sync).toBeNull();
    h.key("y");
    expect(h.state.sync).not.toBeNull();
    expect(h.state.sync?.index).toBe(0);
  });
});

describe("input handler — search prompt", () => {
  test("/ opens search, typing sets the query live, Esc clears it", () => {
    const h = harness();
    h.key("/");
    expect(h.state.input?.kind).toBe("search");
    h.key("t");
    h.key("w");
    h.key("o");
    expect(h.state.search).toBe("two");
    h.key("\x1b");
    expect(h.state.search).toBe("");
    expect(h.state.input).toBeNull();
  });
});

describe("input handler — drill navigation", () => {
  test("Enter drills problems → preview → logs, Esc walks back", () => {
    const h = harness();
    h.key("\r"); // problems → preview
    expect(h.state.focus).toBe("preview");
    h.key("\r"); // preview → logs
    expect(h.state.focus).toBe("logs");
    h.key("\x1b"); // logs → preview
    expect(h.state.focus).toBe("preview");
    h.key("\x1b"); // preview → problems
    expect(h.state.focus).toBe("problems");
  });
});

describe("input handler — repaints", () => {
  test("every handled key triggers a render", () => {
    const h = harness();
    const before = h.renders();
    h.key("j");
    expect(h.renders()).toBeGreaterThan(before);
  });
});

describe("logs transcript (append, don't clear)", () => {
  test("logsAppendRun accumulates blocks for the same problem", () => {
    const s = { logs: { slug: null, status: "idle", lines: [], scroll: 0 } } as unknown as State;
    logsBeginRun(s, "two-sum", "compiling…");
    expect(s.logs.status).toBe("running");
    logsAppendRun(s, "two-sum", "test", ["1/1 passed"], "PASS", true);
    expect(s.logs.status).toBe("done");
    expect(s.logs.lines).toContain("── test ──");
    expect(s.logs.lines).toContain("1/1 passed");

    // A second run on the same problem appends rather than replacing.
    logsBeginRun(s, "two-sum", "submitting…");
    expect(s.logs.lines).toContain("1/1 passed"); // prior output kept
    logsAppendRun(s, "two-sum", "submit", ["✓ Accepted"], "Accepted", true);
    expect(s.logs.lines.filter((l) => l.startsWith("── ")).length).toBe(2); // two blocks
    expect(s.logs.lines).toContain("1/1 passed"); // first run still present
    expect(s.logs.lines).toContain("✓ Accepted");
    // Auto-scroll lands on the newest block's header.
    expect(s.logs.lines[s.logs.scroll]).toBe("── submit ──");
  });

  test("switching problems starts a fresh transcript", () => {
    const s = { logs: { slug: "two-sum", status: "done", lines: ["── test ──", "old"], scroll: 0 } } as unknown as State;
    logsBeginRun(s, "add-two-numbers", "compiling…");
    expect(s.logs.lines).not.toContain("old"); // previous problem's log dropped
    logsAppendRun(s, "add-two-numbers", "test", ["fresh"], "PASS", true);
    expect(s.logs.lines).toContain("fresh");
    expect(s.logs.lines).not.toContain("old");
  });
});
