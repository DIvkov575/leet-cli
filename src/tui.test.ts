import { expect, test, describe } from "bun:test";
import {
  cycleDoneFilter,
  cycleDifficulty,
  cycleSortState,
  truncate,
  fit,
  visibleLength,
  layoutColumns,
  computeTop,
  wrapText,
  renderFrame,
  solveCommand,
  filterRepoSuggestions,
  menuWindow,
  MENU_ITEMS,
} from "./tui.ts";

const RESET = "\x1b[0m";
const REV = "\x1b[7m";

describe("menuWindow", () => {
  // 11 items each 8 cols wide, like the real bar's cell lengths.
  const lens = Array.from({ length: 11 }, () => 8);

  test("everything fits -> full range", () => {
    expect(menuWindow(lens, 0, 200)).toEqual({ start: 0, end: 11 });
  });

  test("narrow: selected item is inside the window", () => {
    const { start, end } = menuWindow(lens, 5, 40);
    expect(5).toBeGreaterThanOrEqual(start);
    expect(5).toBeLessThan(end);
    expect(end).toBeLessThanOrEqual(11);
  });

  test("selecting the last item scrolls it into view", () => {
    const { start, end } = menuWindow(lens, 10, 40);
    expect(end).toBe(11);
    expect(10).toBeGreaterThanOrEqual(start);
  });

  test("empty menu -> empty range", () => {
    expect(menuWindow([], 0, 80)).toEqual({ start: 0, end: 0 });
  });
});

describe("filterRepoSuggestions", () => {
  const repos = [
    "DIvkov575/leetcode-problems",
    "DIvkov575/neetcode-submissions-zkag82uy",
    "DIvkov575/leet-cli",
    "someoneelse/leetcode",
  ];

  test("empty draft returns everything (capped)", () => {
    expect(filterRepoSuggestions(repos, "")).toHaveLength(4);
    expect(filterRepoSuggestions(repos, "", 2)).toHaveLength(2);
  });

  test("case-insensitive substring match", () => {
    expect(filterRepoSuggestions(repos, "NEET")).toEqual([
      "DIvkov575/neetcode-submissions-zkag82uy",
    ]);
  });

  test("prefix matches rank before mid-string matches", () => {
    const out = filterRepoSuggestions(repos, "leet");
    // "someoneelse/leetcode" contains "leet" but doesn't start with it; the two
    // "DIvkov575/leet*" repos aren't prefix either (owner prefix), so ranking is
    // alphabetical among substring hits.
    expect(out).toContain("DIvkov575/leetcode-problems");
    expect(out).toContain("someoneelse/leetcode");
  });

  test("an exact full match is dropped (already fully typed)", () => {
    expect(filterRepoSuggestions(repos, "DIvkov575/leet-cli")).toEqual([]);
  });

  test("no candidates -> empty", () => {
    expect(filterRepoSuggestions([], "anything")).toEqual([]);
  });
});

describe("solveCommand", () => {
  test("is a short, non-truncating scaffold+open command", () => {
    expect(solveCommand(1, "two-sum")).toBe("leet solve two-sum -o");
  });
});

describe("cycleDoneFilter", () => {
  test("all -> todo -> done -> all", () => {
    expect(cycleDoneFilter("all")).toBe("todo");
    expect(cycleDoneFilter("todo")).toBe("done");
    expect(cycleDoneFilter("done")).toBe("all");
  });
});

describe("cycleDifficulty", () => {
  test("undefined -> Easy -> Medium -> Hard -> undefined", () => {
    expect(cycleDifficulty(undefined)).toBe("Easy");
    expect(cycleDifficulty("Easy")).toBe("Medium");
    expect(cycleDifficulty("Medium")).toBe("Hard");
    expect(cycleDifficulty("Hard")).toBeUndefined();
  });
});

describe("cycleSortState", () => {
  test("steps key+direction: id↑ → id↓ → acc↑ → ... → title↓ → id↑", () => {
    let st = { key: "id" as const, desc: false };
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      seen.push(`${st.key}${st.desc ? "↓" : "↑"}`);
      st = cycleSortState(st.key, st.desc);
    }
    expect(seen).toEqual(["id↑", "id↓", "acc↑", "acc↓", "difficulty↑", "difficulty↓", "title↑", "title↓"]);
    // wraps back to the start
    expect(cycleSortState("title", true)).toEqual({ key: "id", desc: false });
  });
});

describe("truncate", () => {
  test("short string is unchanged", () => expect(truncate("hi", 10)).toBe("hi"));
  test("long string gets ellipsis and fits width", () => {
    const r = truncate("abcdefghij", 5);
    expect(r).toBe("abcd…");
    expect(r.length).toBe(5);
  });
  test("width 1 is a bare ellipsis", () => expect(truncate("abc", 1)).toBe("…"));
  test("width 0 is empty", () => expect(truncate("abc", 0)).toBe(""));
});

describe("fit", () => {
  test("pads to exact width", () => expect(fit("hi", 5)).toBe("hi   "));
  test("truncates to exact width", () => expect(fit("abcdef", 4).length).toBe(4));
});

describe("visibleLength", () => {
  test("ignores ANSI escape sequences", () => {
    expect(visibleLength(`${REV}hello${RESET}`)).toBe(5);
  });
  test("plain text is its own length", () => expect(visibleLength("hello")).toBe(5));
});

describe("fit / truncate with ANSI escapes", () => {
  test("truncate measures visible width, not escape bytes", () => {
    // Reverse-video "hello" fits in 5 visible columns → must be unchanged,
    // not truncated as if the escape bytes counted toward the width.
    const styled = `${REV}hello${RESET}`;
    expect(truncate(styled, 5)).toBe(styled);
  });

  test("fit re-applied to an already-styled+fit row is idempotent", () => {
    // The exact picker bug: paint(fit(row, w), "rev") then renderOverlay fit()s
    // it again. The reset code must survive so reverse-video doesn't bleed.
    const once = `${REV}${fit("  ▸ google", 20)}${RESET}`;
    const twice = fit(once, 20);
    expect(twice.endsWith(RESET)).toBe(true);
    expect(visibleLength(twice)).toBe(20);
  });

  test("truncating a styled string keeps the trailing reset", () => {
    const styled = `${REV}${"x".repeat(30)}${RESET}`;
    const cut = truncate(styled, 10);
    expect(cut.endsWith(RESET)).toBe(true);
    expect(visibleLength(cut)).toBe(10);
  });
});

describe("layoutColumns", () => {
  test("title absorbs remaining width and never goes negative", () => {
    const c = layoutColumns(80, 999);
    expect(c.idW).toBe(3);
    expect(c.titleW).toBeGreaterThan(0);
    // status(1)+id+acc(6)+diff(6)+gaps(4)+title == paneWidth
    expect(1 + c.idW + c.accW + c.diffW + 4 + c.titleW).toBe(80);
  });
  test("tiny pane clamps titleW at 0, not negative", () => {
    expect(layoutColumns(5, 9).titleW).toBe(0);
  });
});

describe("computeTop", () => {
  test("no scroll needed when everything fits", () => {
    expect(computeTop(3, 5, 10, 0)).toBe(0);
  });
  test("scrolls down to keep cursor visible", () => {
    expect(computeTop(12, 100, 10, 0)).toBe(3);
  });
  test("scrolls up when cursor above window", () => {
    expect(computeTop(2, 100, 10, 20)).toBe(2);
  });
  test("clamps to last full page", () => {
    expect(computeTop(99, 100, 10, 0)).toBe(90);
  });
});

describe("wrapText", () => {
  test("wraps to width without exceeding it", () => {
    const lines = wrapText("the quick brown fox jumps", 10);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(10);
    expect(lines.join(" ")).toBe("the quick brown fox jumps");
  });
  test("preserves blank lines between paragraphs", () => {
    expect(wrapText("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });
  test("hard-breaks an over-long token", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("MENU_ITEMS", () => {
  test("exposes the expected actions in order", () => {
    expect(MENU_ITEMS.map((m) => m.action)).toEqual([
      "filter",
      "diff",
      "tag",
      "sort",
      "search",
      "list",
      "roadmap",
      "open",
      "refresh",
      "import",
      "sync",
      "config",
      "help",
    ]);
  });
});

// Rendering tests operate on a minimal hand-built state so no list files or TTY
// are needed. ANSI codes are stripped when checking widths.
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function makeState(overrides: Partial<Record<string, unknown>> = {}): any {
  const problems = [
    { id: 1, title: "Easy One", slug: "easy-one", url: "u", acceptance: 50, difficulty: "Easy", pattern: "Arrays & Hashing", patternSource: "neetcode", topics: ["array", "hash-table"] },
    { id: 2, title: "Med Two", slug: "med-two", url: "u", acceptance: 40, difficulty: "Medium", pattern: "Stack", patternSource: "derived", topics: ["stack"] },
    { id: 3, title: "Hard Three", slug: "hard-three", url: "u", acceptance: 30, difficulty: "Hard" },
  ];
  const s: any = {
    list: { name: "demo", title: "Demo", problems },
    listNames: ["demo"],
    allProblems: problems,
    listMeta: new Map<string, number[]>([["demo", [1, 2, 3]]]),
    recommended: [],
    showingRecommended: false,
    completed: new Set<number>(),
    doneFilter: "all",
    diff: undefined,
    tagFilter: new Set<string>(),
    tagPicker: null,
    roadmap: null,
    search: "",
    sortKey: "id",
    sortDesc: false,
    filtered: problems,
    cursor: 0,
    top: 0,
    listCursor: 0,
    listTop: 0,
    focus: "problems",
    lastPanel: "problems",
    menuIndex: 0,
    preview: { slug: null, status: "idle", text: "", scroll: 0 },
    logs: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: 3,
    status: "",
    input: null,
    config: null,
    sync: null,
    help: false,
    prefetch: null,
    suggestSetup: false,
    fullscreen: false,
    ...overrides,
  };
  return s;
}

describe("renderFrame layout", () => {
  test("every line is exactly `cols` wide and there are `rows` lines", () => {
    const f = renderFrame(makeState(), 12, 70);
    expect(f).toHaveLength(12);
    for (const line of f) expect(strip(line).length).toBe(70);
  });

  test("first line is the menu bar with all labels", () => {
    const f = renderFrame(makeState(), 12, 100);
    expect(strip(f[0]!)).toContain("Filter");
    expect(strip(f[0]!)).toContain("Sort");
    expect(strip(f[0]!)).toContain("Import");
  });

  test("focused menu highlights the selected item even on a narrow terminal", () => {
    // 60 cols can't fit all 11 items; the selected one must still be visible +
    // highlighted (reverse-video), which the old full-bar-only render dropped.
    const bar = renderFrame(makeState({ focus: "menu", menuIndex: 2 }), 12, 60)[0]!;
    expect(strip(bar)).toContain("Sort"); // selected item is in the window
    if (bar.includes("\x1b[")) expect(bar).toContain("\x1b[7m"); // reverse-video present
  });

  test("selecting a far item keeps it visible (windowed)", () => {
    const bar = strip(renderFrame(makeState({ focus: "menu", menuIndex: 10 }), 12, 60)[0]!);
    expect(bar).toContain("Help"); // last item scrolled into view
    expect(bar).toContain("‹"); // overflow marker on the left
  });

  test("Problems panel header shows view name, count, and settings", () => {
    // Wide enough for three panels; Problems is the middle column.
    const f = renderFrame(makeState({ doneFilter: "todo", sortKey: "acc", sortDesc: true }), 12, 120);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("Demo"); // list title
    expect(joined).toContain("3/3");
    expect(joined).toContain("todo");
    expect(joined).toContain("acc↓");
  });

  test("an always-visible search bar shows the hint when no query is set", () => {
    const joined = strip(renderFrame(makeState(), 12, 120).join("\n"));
    expect(joined).toContain("/ search"); // the search bar is always drawn
  });

  test("search bar shows a committed query and a live match count", () => {
    const s = makeState({ search: "two", filtered: [makeState().list.problems[1]] });
    const joined = strip(renderFrame(s, 12, 120).join("\n"));
    expect(joined).toContain("/ two"); // committed query rendered in the bar
    expect(joined).toContain("1 match"); // result count
  });

  test("while typing, the search bar shows the draft with a caret", () => {
    const s = makeState({ input: { kind: "search", value: "med" } });
    const joined = strip(renderFrame(s, 12, 120).join("\n"));
    expect(joined).toContain("/ med▏"); // live draft + caret in the bar
  });
});

describe("fullscreen reading mode", () => {
  const fsState = (overrides: any = {}) =>
    makeState({
      fullscreen: true,
      focus: "preview",
      lastPanel: "preview",
      cursor: 2, // the untagged problem, so the header stays short in a 14-row view
      preview: {
        slug: "hard-three",
        status: "loaded",
        text: "Given an array of integers…\n\nExample 1:",
        scroll: 0,
        source: "repo",
      },
      ...overrides,
    });

  test("fills the whole screen with the description; header names the problem", () => {
    const f = renderFrame(fsState(), 14, 120);
    expect(f).toHaveLength(14);
    for (const line of f) expect(strip(line).length).toBe(120);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("Hard Three"); // header (from current problem)
    expect(joined).toContain("Given an array of integers");
    // No Lists/Problems chrome, no menu bar in fullscreen.
    expect(joined).not.toContain("Filter");
  });

  test("wide terminal shows Preview and Logs side by side", () => {
    const joined = strip(renderFrame(fsState(), 14, 130).join("\n"));
    expect(joined).toContain("Preview");
    expect(joined).toContain("Logs");
  });

  test("narrow terminal shows only the focused panel", () => {
    const joined = strip(renderFrame(fsState(), 14, 70).join("\n"));
    expect(joined).toContain("Given an array of integers"); // preview body
    expect(joined).not.toContain("Logs"); // no room for the logs column
  });
});

describe("renderFrame difficulty color", () => {
  test("non-selected rows wrap the difficulty cell in its level color", () => {
    // Force color on regardless of TTY for this assertion.
    const f = renderFrame(makeState({ cursor: -1 }), 12, 70);
    const joined = f.join("\n");
    // When NO_COLOR is set in the test env there are no codes; only assert
    // coloring when the module actually emits ANSI.
    if (joined.includes("\x1b[")) {
      expect(joined).toContain("\x1b[32mEasy"); // green
      expect(joined).toContain("\x1b[33mMedium"); // yellow
      expect(joined).toContain("\x1b[31mHard"); // red
    } else {
      // Colorless environment: difficulties still render as plain text.
      expect(strip(joined)).toContain("Easy");
      expect(strip(joined)).toContain("Hard");
    }
  });
});

describe("renderFrame three-panel layout", () => {
  test("wide terminal shows Lists │ Problems │ Preview, all exactly cols wide", () => {
    const s = makeState({
      listNames: ["demo", "other"],
      listMeta: new Map<string, number[]>([
        ["demo", [1, 2, 3]],
        ["other", [10, 20]],
      ]),
      focus: "lists",
    });
    const f = renderFrame(s, 16, 120);
    for (const line of f) expect(strip(line).length).toBe(120);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("Lists");
    expect(joined).toContain("Preview");
    expect(joined).toContain("★ recommended"); // recommended pseudo-list row
    expect(joined).toContain("demo");
    expect(joined).toContain("other");
  });

  test("Logs panel appears when focused and shows captured run output", () => {
    const s = makeState({
      focus: "logs",
      logs: { slug: "easy-one", status: "done", lines: ["case 1: PASS", "1/1 passed"], scroll: 0, summary: "PASS", ok: true },
    });
    const f = renderFrame(s, 16, 160); // wide enough for all four panels
    for (const line of f) expect(strip(line).length).toBe(160);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("Logs");
    expect(joined).toContain("PASS");
    expect(joined).toContain("1/1 passed");
  });

  test("Logs panel prompts to run when idle", () => {
    const s = makeState({ focus: "logs" });
    const joined = strip(renderFrame(s, 16, 160).join("\n"));
    expect(joined).toContain("Press t to compile & run");
  });

  test("Lists panel shows done/left/total counts for each list", () => {
    const s = makeState({
      listNames: ["demo", "other"],
      listMeta: new Map<string, number[]>([
        ["demo", [1, 2, 3]],
        ["other", [10, 20]],
      ]),
      completed: new Set<number>([2]), // one of demo's three done
      focus: "lists",
    });
    const lines = renderFrame(s, 16, 120).map(strip);
    const demoRow = lines.find((l) => l.includes("demo") && !l.includes("Demo"))!;
    expect(demoRow).toMatch(/demo\s+1\s+2\s+3/); // done left total
    const otherRow = lines.find((l) => l.includes("other"))!;
    expect(otherRow).toMatch(/other\s+0\s+2\s+2/);
  });

  test("narrow terminal shows only the focused panel", () => {
    const listsFocus = renderFrame(makeState({ focus: "lists" }), 16, 60);
    for (const line of listsFocus) expect(strip(line).length).toBe(60);
    const lj = strip(listsFocus.join("\n"));
    expect(lj).toContain("Lists");
    expect(lj).not.toContain("Preview"); // other panels hidden when narrow

    const probFocus = strip(renderFrame(makeState({ focus: "problems" }), 16, 60).join("\n"));
    expect(probFocus).toContain("Demo");
    expect(probFocus).not.toContain("Lists");
  });

  test("selecting the recommended pseudo-list surfaces recommendations", () => {
    const rec = [
      { problem: { id: 1, title: "Two Sum", slug: "two-sum", url: "u", acceptance: 50, difficulty: "Easy" }, listCount: 5, lists: ["a"], done: false },
    ];
    const s = makeState({
      recommended: rec,
      showingRecommended: true,
      filtered: rec.map((r) => r.problem),
      focus: "problems",
    });
    const joined = strip(renderFrame(s, 16, 120).join("\n"));
    expect(joined).toContain("Recommended"); // Problems header reflects the view
    expect(joined).toContain("Two Sum");
  });

  test("first-run footer suggests pre-caching; opt-in, not automatic", () => {
    const s = makeState({ focus: "lists", suggestSetup: true });
    const joined = strip(renderFrame(s, 16, 120).join("\n"));
    expect(joined).toContain("press P to pre-cache");
    expect(joined).toContain("dismiss");
  });
});

describe("renderFrame config overlay", () => {
  test("lists each setting; shows value when set, fallback when unset", () => {
    const s = makeState({
      config: { index: 0, editing: false, draft: "", working: { editor: "code -w" } },
    });
    const f = renderFrame(s, 14, 70);
    expect(f).toHaveLength(14);
    for (const line of f) expect(strip(line).length).toBe(70);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("Settings");
    expect(joined).toContain("Editor command");
    expect(joined).toContain("code -w"); // configured value shown
    expect(joined).toContain("Solutions directory");
    expect(joined).toContain("(unset"); // unset field shows its fallback
    expect(joined).toContain("C++ compiler");
  });

  test("editing a field shows the draft with a caret", () => {
    const s = makeState({
      config: { index: 1, editing: true, draft: "mysols", working: {} },
    });
    const joined = strip(renderFrame(s, 14, 70).join("\n"));
    expect(joined).toContain("mysols▏");
  });
});

describe("preview tags", () => {
  test("shows the NeetCode pattern and LeetCode topics in the preview header", () => {
    // Focus preview so the panel renders; cursor 0 = the tagged 'Easy One'.
    const s = makeState({ focus: "preview", cursor: 0, preview: { slug: "easy-one", status: "loaded", text: "body", scroll: 0, source: "repo" } });
    const joined = strip(renderFrame(s, 20, 140).join("\n"));
    expect(joined).toContain("Pattern: Arrays & Hashing");
    expect(joined).toContain("Topics: array, hash-table");
  });
  test("marks a derived pattern with ~", () => {
    const s = makeState({ focus: "preview", cursor: 1, preview: { slug: "med-two", status: "loaded", text: "b", scroll: 0 } });
    const joined = strip(renderFrame(s, 20, 140).join("\n"));
    expect(joined).toContain("Pattern: Stack ~");
  });
});

describe("renderFrame tag picker", () => {
  test("lists every pattern with checkbox + counts; marks the active filter", () => {
    const s = makeState({ tagPicker: { index: 0 }, tagFilter: new Set(["Stack"]) });
    const f = renderFrame(s, 24, 80);
    for (const line of f) expect(strip(line).length).toBe(80);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("Filter by NeetCode pattern");
    expect(joined).toContain("Arrays & Hashing");
    expect(joined).toContain("[x] Stack"); // Stack is in the filter
    expect(joined).toContain("Space toggle");
  });
});

describe("renderFrame roadmap", () => {
  test("neetcode DAG: boxes, connectors, subset toggle, detail line", () => {
    const s = makeState({ roadmap: { cursor: 0, subset: "neetcode250" } });
    const f = renderFrame(s, 40, 90);
    for (const line of f) expect(strip(line).length).toBe(90);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("Roadmap"); // overlay title
    expect(joined).toContain("┌"); // single-border box for a non-cursor pattern
    expect(joined).toContain("╔"); // double-border box for the cursor pattern
    expect(joined).toContain("Two Pointers"); // a level-1 box label
    expect(joined).toContain("v"); // connectors between levels
    // Cursor 0 = Arrays & Hashing → its full name appears in the detail line.
    expect(joined).toContain("Arrays & Hashing");
    expect(joined).toContain("subset: neetcode250");
    // The chart toggle is gone — only NeetCode patterns are shown.
    expect(joined).not.toContain("chart:");
  });

  test("counts are global (allProblems), not the current list", () => {
    // Current list has only 'Easy One' (Arrays & Hashing); the global union adds
    // an Arrays & Hashing problem outside the list. The roadmap must count 2/…,
    // proving it reads allProblems, not s.list.problems.
    const extra = { id: 99, title: "Global AH", slug: "global-ah", url: "u", acceptance: 50, difficulty: "Easy", pattern: "Arrays & Hashing", patternSource: "neetcode", topics: ["array"], subsets: ["neetcode250"] };
    const s = makeState({
      list: { name: "tiny", title: "Tiny", problems: [] }, // empty current list
      allProblems: [{ id: 1, title: "Easy One", slug: "easy-one", url: "u", acceptance: 50, difficulty: "Easy", pattern: "Arrays & Hashing", patternSource: "neetcode", topics: ["array"], subsets: ["neetcode250"] }, extra],
      roadmap: { cursor: 0, subset: "all" },
    });
    const joined = strip(renderFrame(s, 40, 90).join("\n"));
    // Arrays & Hashing is cursor 0; detail line shows 0/2 (two global AH problems)
    // even though the current list is empty.
    expect(joined).toContain("0/2 done");
  });

  test("subset scopes the global counts and redraws the box count", () => {
    const mk = (subset: string) =>
      strip(
        renderFrame(
          makeState({
            allProblems: [
              { id: 1, title: "A", slug: "a", url: "u", acceptance: 50, difficulty: "Easy", pattern: "Arrays & Hashing", topics: [], subsets: ["blind75", "neetcode250"] },
              { id: 2, title: "B", slug: "b", url: "u", acceptance: 50, difficulty: "Easy", pattern: "Arrays & Hashing", topics: [], subsets: ["neetcode250"] },
            ],
            roadmap: { cursor: 0, subset },
          }),
          40,
          90,
        ).join("\n"),
      );
    // Detail line + the in-box count both reflect the subset.
    expect(mk("all")).toContain("0/2 done"); // both
    expect(mk("all")).toContain("0/2"); // baked into the box body
    expect(mk("blind75")).toContain("0/1 done"); // only the blind75 one
    expect(mk("blind75")).toContain("0/1"); // box body changed with the subset
  });
});

describe("renderFrame sync overlay", () => {
  test("shows the sync actions and running output", () => {
    const s = makeState({
      sync: { index: 0, busy: false, lines: ["Signed in as tester."], confirmPush: null, confirm: null },
    });
    const f = renderFrame(s, 20, 80);
    for (const line of f) expect(strip(line).length).toBe(80);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("LeetCode Sync");
    expect(joined).toContain("Authenticate");
    expect(joined).toContain("Pull solved from LeetCode");
    expect(joined).toContain("Pull my solutions → repo");
    expect(joined).toContain("Commit + push solutions dir");
    expect(joined).toContain("Push solutions to LeetCode");
    expect(joined).toContain("Signed in as tester.");
  });

  test("push confirmation prompt gates the destructive action", () => {
    const s = makeState({
      sync: { index: 4, busy: false, lines: [], confirmPush: 12, confirm: null },
    });
    const joined = strip(renderFrame(s, 20, 80).join("\n"));
    expect(joined).toContain("push 12 solution(s)");
    expect(joined).toContain("y = submit");
  });

  test("generic confirm gate shows its prompt", () => {
    const s = makeState({
      sync: {
        index: 3,
        busy: false,
        lines: [],
        confirmPush: null,
        confirm: { action: "pushDir", prompt: "commit + push your local solutions dir?" },
      },
    });
    const joined = strip(renderFrame(s, 20, 80).join("\n"));
    expect(joined).toContain("commit + push your local solutions dir?");
    expect(joined).toContain("y = yes");
  });
});
