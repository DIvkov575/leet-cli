import { expect, test, describe } from "bun:test";
import {
  cycleDoneFilter,
  cycleDifficulty,
  truncate,
  fit,
  layoutColumns,
  computeTop,
  wrapText,
} from "./tui.ts";

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
