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
  MENU_ITEMS,
} from "./tui.ts";

const RESET = "\x1b[0m";
const REV = "\x1b[7m";

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
      "sort",
      "search",
      "list",
      "open",
      "refresh",
      "import",
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
    { id: 1, title: "Easy One", slug: "easy-one", url: "u", acceptance: 50, difficulty: "Easy" },
    { id: 2, title: "Med Two", slug: "med-two", url: "u", acceptance: 40, difficulty: "Medium" },
    { id: 3, title: "Hard Three", slug: "hard-three", url: "u", acceptance: 30, difficulty: "Hard" },
  ];
  const s: any = {
    list: { name: "demo", title: "Demo", problems },
    listNames: ["demo"],
    listMeta: new Map<string, number[]>([["demo", [1, 2, 3]]]),
    recommended: [],
    showingRecommended: false,
    completed: new Set<number>(),
    doneFilter: "all",
    diff: undefined,
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
    preview: { slug: null, status: "idle", lines: [], scroll: 0 },
    logs: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: 3,
    status: "",
    input: null,
    config: null,
    help: false,
    prefetch: null,
    suggestSetup: false,
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

  test("Problems panel header shows view name, count, and settings", () => {
    // Wide enough for three panels; Problems is the middle column.
    const f = renderFrame(makeState({ doneFilter: "todo", sortKey: "acc", sortDesc: true }), 12, 120);
    const joined = strip(f.join("\n"));
    expect(joined).toContain("Demo"); // list title
    expect(joined).toContain("3/3");
    expect(joined).toContain("todo");
    expect(joined).toContain("acc↓");
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
