/**
 * The Tab-able menu bar: its item list, the horizontal-window math that keeps
 * the selected item visible on a narrow terminal, and the bar renderer. Pure —
 * the renderer takes just the focus/selection it needs, not the whole State.
 */
import { fit, paint } from "./ansi.ts";

/**
 * Every action the UI can fire. Only four surface on the Tab-able menu bar
 * (`MENU_ITEMS`); the rest are reached via their direct hotkey or the "Menu"
 * command palette (`PALETTE_ITEMS`). Splitting the union this way keeps the bar
 * uncluttered without dropping any capability.
 */
export type MenuAction =
  | "search"
  | "filter"
  | "roadmap"
  | "menu"
  | "diff"
  | "tag"
  | "sort"
  | "list"
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

/**
 * The Tab-able menu bar, left to right — deliberately just four entries. Search
 * and Roadmap open their views; Filter opens the combined filter/sort overlay
 * (status · difficulty · sort · tags); Menu opens the command palette listing
 * everything else with its key.
 */
export const MENU_ITEMS: readonly MenuItem[] = [
  { label: "Search", action: "search" },
  { label: "Filter", action: "filter" },
  { label: "Roadmap", action: "roadmap" },
  { label: "Menu", action: "menu" },
];

/** A command-palette entry: label, the action it fires, and its direct hotkey. */
export interface PaletteItem {
  label: string;
  action: MenuAction;
  key: string;
}

/**
 * The "Menu" command palette: every action that isn't on the bar, each shown
 * with its direct hotkey so the palette doubles as a discoverable cheatsheet.
 */
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  { label: "Lists", action: "list", key: "L" },
  { label: "Open in browser", action: "open", key: "o" },
  { label: "Sync (auth · pull · push)", action: "sync", key: "—" },
  { label: "Import solved", action: "import", key: "i" },
  { label: "Refresh from LeetCode", action: "refresh", key: "R" },
  { label: "Settings", action: "config", key: "c" },
  { label: "Help", action: "help", key: "?" },
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
