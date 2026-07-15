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
