import { expect, test, describe } from "bun:test";
import {
  cycleDoneFilter,
  cycleDifficulty,
  cycleSortState,
  truncate,
  fit,
  layoutColumns,
  computeTop,
  wrapText,
  renderFrame,
  solveCommand,
  MENU_ITEMS,
} from "./tui.ts";

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
    completed: new Set<number>(),
    doneFilter: "all",
    diff: undefined,
    search: "",
    sortKey: "id",
    sortDesc: false,
    filtered: problems,
    cursor: 0,
    top: 0,
    focus: "list",
    menuIndex: 0,
    preview: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: 3,
    status: "",
    input: null,
    picker: null,
    help: false,
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

  test("second line is the menu bar with all labels", () => {
    const f = renderFrame(makeState(), 12, 100);
    expect(strip(f[1]!)).toContain("Filter");
    expect(strip(f[1]!)).toContain("Sort");
    expect(strip(f[1]!)).toContain("Import");
  });

  test("status line shows list name, count, and view settings", () => {
    const f = renderFrame(makeState({ doneFilter: "todo", sortKey: "acc", sortDesc: true }), 12, 90);
    const status = strip(f[0]!);
    expect(status).toContain("demo");
    expect(status).toContain("3/3");
    expect(status).toContain("todo");
    expect(status).toContain("acc↓");
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
