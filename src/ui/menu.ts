/**
 * The Tab-able menu bar: its item list, the horizontal-window math that keeps
 * the selected item visible on a narrow terminal, and the bar renderer. Pure —
 * the renderer takes just the focus/selection it needs, not the whole State.
 */
import { fit, paint } from "./ansi.ts";

export type MenuAction =
  | "filter"
  | "diff"
  | "tag"
  | "sort"
  | "search"
  | "list"
  | "roadmap"
  | "open"
  | "refresh"
  | "import"
  | "sync"
  | "config"
  | "help";

export interface MenuItem {
  label: string;
  action: MenuAction;
}

/** The Tab-able menu bar, left to right. */
export const MENU_ITEMS: readonly MenuItem[] = [
  { label: "Filter", action: "filter" },
  { label: "Difficulty", action: "diff" },
  { label: "Tag", action: "tag" },
  { label: "Sort", action: "sort" },
  { label: "Search", action: "search" },
  { label: "List", action: "list" },
  { label: "Roadmap", action: "roadmap" },
  { label: "Open", action: "open" },
  { label: "Refresh", action: "refresh" },
  { label: "Import", action: "import" },
  { label: "Sync", action: "sync" },
  { label: "Config", action: "config" },
  { label: "Help", action: "help" },
];

/**
 * The contiguous run of menu items [start, end) to show so that item `sel` is
 * visible and the row (cells joined by single spaces, plus optional ‹/› overflow
 * markers) fits within `cols`. Grows outward from `sel`, preferring to reveal
 * following items first, so the highlighted item is never clipped on a narrow
 * terminal. Pure, so it's unit-tested.
 */
export function menuWindow(cellLens: number[], sel: number, cols: number): { start: number; end: number } {
  const n = cellLens.length;
  if (n === 0) return { start: 0, end: 0 };
  const sepAndMarkers = 4; // slack for a leading "‹ " and trailing " ›"
  const budget = Math.max(1, cols - sepAndMarkers);
  let start = Math.max(0, Math.min(sel, n - 1));
  let end = start + 1;
  let used = cellLens[start]!;
  // Alternate expanding right then left until we run out of room.
  let grow = true;
  while (grow) {
    grow = false;
    if (end < n && used + 1 + cellLens[end]! <= budget) {
      used += 1 + cellLens[end]!;
      end++;
      grow = true;
    }
    if (start > 0 && used + 1 + cellLens[start - 1]! <= budget) {
      start--;
      used += 1 + cellLens[start]!;
      grow = true;
    }
  }
  return { start, end };
}

/**
 * Render the menu bar to exactly `cols`. When `focused` is false it's a dim,
 * possibly-truncated strip; when focused, `menuIndex` is highlighted and, if the
 * full bar overflows, a horizontal window around the selection is shown with
 * ‹/› overflow markers so the highlight is never clipped.
 */
export function renderMenuBar(focused: boolean, menuIndex: number, cols: number): string {
  const cells = MENU_ITEMS.map((it) => ` ${it.label} `);
  const plainLen = cells.reduce((n, c) => n + c.length, 0) + (cells.length - 1);

  if (!focused) return paint(fit(cells.join(" "), cols), "dim");

  if (plainLen <= cols) {
    const styled = cells
      .map((c, i) => (i === menuIndex ? paint(c, "rev", "bold") : c))
      .join(" ");
    return styled + " ".repeat(cols - plainLen);
  }

  const { start, end } = menuWindow(cells.map((c) => c.length), menuIndex, cols);
  const parts = cells
    .slice(start, end)
    .map((c, i) => (start + i === menuIndex ? paint(c, "rev", "bold") : paint(c, "bold")));
  let bar = parts.join(" ");
  if (start > 0) bar = paint("‹", "dim") + " " + bar;
  if (end < cells.length) bar = bar + " " + paint("›", "dim");
  return fit(bar, cols);
}
