import type { Difficulty, Problem, ProblemList } from "./types.ts";
import {
  availableLists,
  filterProblems,
  loadList,
  saveList,
  sortProblems,
  type SortKey,
} from "./lib.ts";
import { fetchProblem, fetchProblems } from "./leetcode.ts";
import { htmlToText } from "./render.ts";
import { importSource } from "./import.ts";
import { loadCompleted, saveCompleted } from "./progress.ts";
import {
  loadConfig,
  saveConfig,
  resolveEditor,
  resolveSolutionsDir,
  CONFIG_FIELDS,
  type Config,
} from "./config.ts";
import { prefetchProblems } from "./prefetch.ts";
import { recommendProblems, type Recommendation } from "./recommend.ts";
import { setupHasRun, markSetupDone } from "./setup.ts";
import { getCached, putCached } from "./cache.ts";
import { scaffoldContent, scaffoldFilename } from "./scaffold.ts";
import { mkdir } from "node:fs/promises";

/** Study set suggested for pre-caching on first run. */
const SUGGESTED_SETUP_LIST = "neetcode-250";

/**
 * Interactive full-screen browser for the bundled lists — the primary way to
 * use the tool and a front-end for every subcommand. Actions live in a Tab-able
 * menu bar (Filter/Sort/Search/List/Refresh/Import/…) so nothing needs to be
 * memorized; the list stays navigable with the arrow keys throughout.
 *
 * All layout/logic math is in pure exported helpers so it can be unit-tested
 * without a real terminal; the runtime section wires them to raw-mode stdin.
 */

// ─── pure layout / logic helpers (tested) ─────────────────────────────────

export type DoneFilter = "all" | "todo" | "done";

/** Cycle the done filter: all → todo → done → all. */
export function cycleDoneFilter(cur: DoneFilter): DoneFilter {
  return cur === "all" ? "todo" : cur === "todo" ? "done" : "all";
}

/** Cycle difficulty: undefined → Easy → Medium → Hard → undefined. */
export function cycleDifficulty(cur: Difficulty | undefined): Difficulty | undefined {
  const order: (Difficulty | undefined)[] = [undefined, "Easy", "Medium", "Hard"];
  return order[(order.indexOf(cur) + 1) % order.length];
}

/**
 * Cycle sort key + direction together, so a single action steps through every
 * ordering: id↑ → id↓ → acc↑ → acc↓ → difficulty↑ → … → title↓ → id↑.
 */
export function cycleSortState(key: SortKey, desc: boolean): { key: SortKey; desc: boolean } {
  const keys: SortKey[] = ["id", "acc", "difficulty", "title"];
  const seq = keys.indexOf(key) * 2 + (desc ? 1 : 0);
  const next = (seq + 1) % (keys.length * 2);
  return { key: keys[Math.floor(next / 2)]!, desc: next % 2 === 1 };
}

// CSI SGR escapes ("\x1b[…m") — the only ANSI we emit (color/bold/reverse/reset).
// Matched globally for stripping, and with a sticky copy for position-anchored scans.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const ANSI_AT = /\x1b\[[0-9;]*m/y;
const RESET = "\x1b[0m";

/** Number of visible columns, ignoring ANSI escape sequences. */
export function visibleLength(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

/**
 * Truncate to `width` *visible* columns, marking cuts with a trailing "…".
 * ANSI escapes are copied through without counting toward the width, and if the
 * input carried any styling the result is closed with a reset so it can't bleed
 * into the rest of the frame — important because rows are often fit() twice
 * (once when styled, again when composed into an overlay).
 */
export function truncate(s: string, width: number): string {
  if (width <= 0) return "";
  if (visibleLength(s) <= width) return s;

  const target = width - 1; // leave a column for the ellipsis
  let out = "";
  let count = 0;
  let i = 0;
  while (i < s.length && count < target) {
    ANSI_AT.lastIndex = i;
    const m = ANSI_AT.exec(s);
    if (m) {
      out += m[0]; // escape: emit verbatim, does not consume a column
      i += m[0].length;
      continue;
    }
    out += s[i]!;
    count++;
    i++;
  }
  out += "…";
  // Close any styling opened before the cut so it doesn't leak downstream.
  if (s.includes("\x1b[")) out += RESET;
  return out;
}

/** Pad (right) or truncate to exactly `width` visible columns. */
export function fit(s: string, width: number): string {
  if (width <= 0) return "";
  const t = truncate(s, width);
  return t + " ".repeat(Math.max(0, width - visibleLength(t)));
}

export interface Columns {
  idW: number;
  titleW: number;
  accW: number;
  diffW: number;
}

/**
 * Compute column widths for a given pane width. `id`/acc/diff are fixed to
 * their content; the title column absorbs the remainder and is never allowed
 * to wrap — it truncates instead. Returns titleW >= 0.
 */
export function layoutColumns(paneWidth: number, maxId: number): Columns {
  const idW = Math.max(String(maxId).length, 1);
  const accW = 6; // "100.0%"
  const diffW = 6; // "Medium"
  const statusW = 1;
  const gaps = 4; // one space between each of the 5 fields
  const titleW = Math.max(0, paneWidth - statusW - idW - accW - diffW - gaps);
  return { idW, titleW, accW, diffW };
}

/**
 * Scrolling window: given a cursor and viewport height, return the slice of
 * indices [top, top+height) that keeps the cursor visible.
 */
export function computeTop(cursor: number, total: number, height: number, prevTop: number): number {
  if (height <= 0 || total <= height) return 0;
  let top = prevTop;
  if (cursor < top) top = cursor;
  else if (cursor >= top + height) top = cursor - height + 1;
  return Math.max(0, Math.min(top, total - height));
}

/** Word-wrap plain text to `width`, preserving blank lines. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of rawLine.split(/\s+/)) {
      if (word.length > width) {
        // Hard-break a single over-long token.
        if (line) {
          out.push(line);
          line = "";
        }
        for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
        continue;
      }
      if (line.length + (line ? 1 : 0) + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// ─── menu bar ───────────────────────────────────────────────────────────────

export type MenuAction =
  | "filter"
  | "diff"
  | "sort"
  | "search"
  | "list"
  | "open"
  | "refresh"
  | "import"
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
  { label: "Sort", action: "sort" },
  { label: "Search", action: "search" },
  { label: "List", action: "list" },
  { label: "Open", action: "open" },
  { label: "Refresh", action: "refresh" },
  { label: "Import", action: "import" },
  { label: "Config", action: "config" },
  { label: "Help", action: "help" },
];

// ─── ANSI ──────────────────────────────────────────────────────────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  rev: "\x1b[7m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
} as const;
function paint(s: string, ...codes: (keyof typeof C)[]): string {
  if (!useColor) return s;
  return codes.map((k) => C[k]).join("") + s + C.reset;
}
function diffColor(d: Difficulty): keyof typeof C {
  return d === "Easy" ? "green" : d === "Medium" ? "yellow" : "red";
}

// ─── state ───────────────────────────────────────────────────────────────

interface PreviewState {
  slug: string | null;
  status: "idle" | "loading" | "loaded" | "error";
  lines: string[];
  scroll: number;
  error?: string;
}

/** A single-line text prompt (search / import). */
interface InputState {
  kind: "search" | "import";
  value: string;
}

/**
 * Settings overlay. `index` selects a field; when `editing` is true the field's
 * `draft` is being typed. Values live in `working` until saved on close.
 */
interface ConfigState {
  index: number;
  editing: boolean;
  draft: string;
  working: Config;
}

/**
 * The three hierarchical panels (lists → problems → preview) plus the bottom
 * menu bar. Tab/→ moves deeper, Shift-Tab/← moves back; the menu is reachable
 * from any panel and returns focus to where it was.
 */
type Focus = "lists" | "problems" | "preview" | "menu";

/** Sentinel list name for the "★ Recommended" pseudo-list at the top of Lists. */
const RECOMMENDED_LIST = "★ recommended";

interface State {
  list: ProblemList;
  listNames: string[];
  /** Problem ids per bundled list, for the Lists panel's unsolved/total counts. */
  listMeta: Map<string, number[]>;
  /** Ranked recommendations; shown as their own pseudo-list in the Lists panel. */
  recommended: Recommendation[];
  /** True while the Problems panel is showing the recommended set, not `list`. */
  showingRecommended: boolean;
  completed: Set<number>;
  doneFilter: DoneFilter;
  diff: Difficulty | undefined;
  search: string;
  sortKey: SortKey;
  sortDesc: boolean;
  filtered: Problem[];
  /** Cursor within the Problems panel. */
  cursor: number;
  top: number;
  /** Cursor within the Lists panel (0 = ★ Recommended, then each list name). */
  listCursor: number;
  listTop: number;
  focus: Focus;
  /** Panel focus is restored to this when leaving the menu. */
  lastPanel: Exclude<Focus, "menu">;
  menuIndex: number;
  preview: PreviewState;
  maxId: number;
  /** Transient message shown in the footer (cleared on next navigation). */
  status: string;
  /** Active text prompt, or null. */
  input: InputState | null;
  /** Active config overlay, or null. */
  config: ConfigState | null;
  /** Whether the help overlay is showing. */
  help: boolean;
  /** Live prefetch status shown in the footer; null when idle. */
  prefetch: string | null;
  /** First-run: offer to pre-cache the study set (shown once). */
  suggestSetup: boolean;
}

/** The Lists panel's rows: the recommended sentinel followed by every list name. */
function listRows(s: State): string[] {
  return [RECOMMENDED_LIST, ...s.listNames];
}

/** Row index of a list name within listRows() (sentinel occupies index 0). */
function listRows0(names: string[], name: string): number {
  const i = names.indexOf(name);
  return i < 0 ? 0 : i + 1;
}

/** Problems currently shown in the Problems panel (recommended set or the list). */
function problemsView(s: State): Problem[] {
  return s.filtered;
}

function recompute(s: State): void {
  const done = s.doneFilter === "all" ? undefined : s.doneFilter === "done";
  // Source problems: the recommended set (pseudo-list) or the current list.
  const source = s.showingRecommended
    ? s.recommended.map((r) => r.problem)
    : s.list.problems;
  const out = filterProblems(source, {
    difficulty: s.diff,
    search: s.search || undefined,
    completed: s.completed,
    done,
  });
  s.filtered = sortProblems(out, s.sortKey, s.sortDesc);
  if (s.cursor >= s.filtered.length) s.cursor = Math.max(0, s.filtered.length - 1);
}

function current(s: State): Problem | undefined {
  return s.filtered[s.cursor];
}

/**
 * Done / remaining / total counts for a bundled list, computed live against the
 * current completed set. Unknown lists (no metadata loaded) report zeros.
 */
function listCounts(s: State, name: string): { done: number; remaining: number; total: number } {
  const ids = s.listMeta.get(name) ?? [];
  const done = ids.reduce((n, id) => n + (s.completed.has(id) ? 1 : 0), 0);
  return { done, remaining: ids.length - done, total: ids.length };
}

/** Bundled lists (by name, sorted) that contain the given problem id. */
function listsContaining(s: State, id: number): string[] {
  const names: string[] = [];
  for (const name of s.listNames) {
    if ((s.listMeta.get(name) ?? []).includes(id)) names.push(name);
  }
  return names;
}

/**
 * Point the Problems panel at a Lists-panel row: either the ★ Recommended
 * pseudo-list or a bundled list by name. Resets the problem cursor/preview.
 */
async function selectListRow(s: State, name: string): Promise<void> {
  if (name === RECOMMENDED_LIST) {
    s.showingRecommended = true;
    s.maxId = s.recommended.reduce((m, r) => Math.max(m, r.problem.id), 0);
  } else {
    s.showingRecommended = false;
    s.list = await loadList(name);
    s.maxId = s.list.problems.reduce((m, p) => Math.max(m, p.id), 0);
  }
  s.cursor = 0;
  s.top = 0;
  s.preview = { slug: null, status: "idle", lines: [], scroll: 0 };
  recompute(s);
}

/** Human label for the Problems-panel header: list title or "Recommended". */
function currentViewTitle(s: State): string {
  return s.showingRecommended ? "Recommended" : s.list.title;
}

// ─── rendering (pure: state + dims -> lines) ───────────────────────────────

const HELP_LINES = [
  "  leet — key bindings",
  "",
  "  Three hierarchical panels: Lists → Problems → Preview.",
  "  → / Enter drills deeper (open a list, then preview a problem);",
  "  ← / Esc steps back out. The menu bar (top) holds every action —",
  "  Tab enters it, ←→ move, Enter fires; Esc returns to your panel.",
  "",
  "  Navigation",
  "    ↑ ↓ / j k     move within the focused panel",
  "    → / Enter     drill in (list → problems → preview)",
  "    p             preview the selected problem (handy in the narrow view)",
  "    ← / Esc       step back out",
  "    g / G         jump to top / bottom",
  "    PgUp / PgDn   page up / down (Problems)",
  "    Space         toggle done (saved immediately)",
  "    s             solve — scaffold the C++ file and open it",
  "    P             prefetch the current view into the cache (offline)",
  "    Tab           enter the menu bar",
  "    q             quit",
  "",
  "  Direct shortcuts (from any panel)",
  "    f filter   d difficulty   S sort   / search   r random",
  "    L lists    o open         R refresh   i import   c config   ? help",
];

/** Panel headers, highlighted (bold cyan) when that panel holds focus. */
function panelHeader(label: string, focused: boolean, width: number): string {
  const text = `${focused ? "▸ " : "  "}${label}`;
  return focused ? paint(fit(text, width), "bold", "cyan") : paint(fit(text, width), "dim");
}

/** The footer hint / status line, shared across layouts. */
function footerLine(s: State, cols: number): string {
  if (s.input) {
    const label = s.input.kind === "search" ? "/" : "import: ";
    return paint(fit(` ${label}${s.input.value}▏  (Enter apply · Esc cancel)`, cols), "yellow");
  }
  if (s.prefetch) return paint(fit(` ${s.prefetch}`, cols), "yellow");
  if (s.suggestSetup) {
    return paint(
      fit(` First run — press P to pre-cache ${SUGGESTED_SETUP_LIST} for offline use · any key to dismiss`, cols),
      "yellow",
    );
  }
  if (s.status) return paint(fit(` ${s.status}`, cols), "cyan");
  const hint =
    s.focus === "lists"
      ? " ↑↓ move · Enter/→ open list · Tab menu · q quit · ? help"
      : s.focus === "problems"
        ? " ↑↓ move · p/Enter/→ preview · Space done · s solve · ← lists · Tab menu"
        : s.focus === "preview"
          ? " ↑↓ scroll · s solve · o open · Space done · ← back · Tab menu"
          : " ←→ move · Enter fire · Esc back to panel";
  return paint(fit(hint, cols), "dim");
}

/**
 * The Lists panel: a ★ Recommended pseudo-row followed by each bundled list
 * with Done/Left/Total counts. Rendered to exactly `width` × `height`.
 */
function listsPanel(s: State, width: number, height: number, focused: boolean): string[] {
  const rows = listRows(s);
  const numW = 4; // per count column
  const col = (n: number | string): string => String(n).padStart(numW);
  // Name column absorbs the rest after the marker (2) + 3 count columns; names
  // truncate rather than pushing the counts out of the panel.
  const nameW = Math.max(6, width - 2 - numW * 3);
  const bodyH = height - 1; // minus header
  s.listTop = computeTop(s.listCursor, rows.length, bodyH, s.listTop);

  const lines = [panelHeader("Lists", focused, width)];
  for (let i = 0; i < bodyH; i++) {
    const idx = s.listTop + i;
    const name = rows[idx];
    if (name === undefined) {
      lines.push(fit("", width));
      continue;
    }
    const selected = idx === s.listCursor;
    let text: string;
    if (name === RECOMMENDED_LIST) {
      text = `  ${RECOMMENDED_LIST}`;
    } else {
      const { done, remaining, total } = listCounts(s, name);
      text = `  ${fit(name, nameW)}${col(done)}${col(remaining)}${col(total)}`;
    }
    if (selected && focused) lines.push(paint(fit(text, width), "rev"));
    else if (selected) lines.push(paint(fit(text, width), "bold"));
    else lines.push(fit(text, width));
  }
  return lines.slice(0, height);
}

/** One Problems-panel row to exactly `width` cols (status, id, title, acc, difficulty). */
function styleProblemRow(s: State, p: Problem, selected: boolean, focused: boolean, cols5: Columns, width: number): string {
  const done = s.completed.has(p.id);
  const statusCell = done ? "✓" : " ";
  const idCell = String(p.id).padStart(cols5.idW);
  const titleCell = fit(p.title, cols5.titleW);
  const accCell = (p.acceptance === null ? "—" : `${p.acceptance.toFixed(1)}%`).padStart(cols5.accW);
  const diffCell = fit(p.difficulty, cols5.diffW);

  const plain = `${statusCell} ${idCell} ${titleCell} ${accCell} ${diffCell}`;
  const pad = " ".repeat(Math.max(0, width - plain.length));

  if (selected && focused) return paint(plain + pad, "rev");
  if (selected) return paint(plain + pad, "bold");

  const prefix = `${statusCell} ${idCell} ${titleCell} ${accCell}`;
  if (done) return paint(prefix, "dim") + " " + paint(diffCell, "dim", diffColor(p.difficulty)) + pad;
  return prefix + " " + paint(diffCell, diffColor(p.difficulty)) + pad;
}

/** The Problems panel: header (view + counts + filters) then the filtered rows. */
function problemsPanel(s: State, width: number, height: number, focused: boolean): string[] {
  const settings = [
    `${s.doneFilter}`,
    s.diff ?? "any",
    `${s.sortKey}${s.sortDesc ? "↓" : "↑"}`,
    s.search ? `"${s.search}"` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const total = s.showingRecommended ? s.recommended.length : s.list.problems.length;
  const label = `${currentViewTitle(s)}  ${s.filtered.length}/${total}  ${settings}`;
  const bodyH = height - 1;
  const cols5 = layoutColumns(width, s.maxId);
  s.top = computeTop(s.cursor, s.filtered.length, bodyH, s.top);

  const lines = [panelHeader(label, focused, width)];
  for (let i = 0; i < bodyH; i++) {
    const idx = s.top + i;
    const p = s.filtered[idx];
    if (!p) {
      lines.push(fit("", width));
      continue;
    }
    lines.push(styleProblemRow(s, p, idx === s.cursor, focused, cols5, width));
  }
  return lines.slice(0, height);
}

/** The Preview panel: header (problem meta) then the wrapped statement body. */
function previewPanel(s: State, width: number, height: number, focused: boolean): string[] {
  const lines = [panelHeader("Preview", focused, width)];
  const header = previewHeaderLines(s, width);
  const body = previewBody(s, width).slice(s.preview.scroll);
  const composed = [...header, ...body];
  const bodyH = height - 1;
  for (let i = 0; i < bodyH; i++) lines.push(fit(composed[i] ?? "", width));
  return lines.slice(0, height);
}

/** Glue an array of same-height panel column-blocks together with dim separators. */
function joinColumns(blocks: string[][], height: number, widths: number[]): string[] {
  const sep = paint("│", "dim");
  const rows: string[] = [];
  for (let i = 0; i < height; i++) {
    rows.push(blocks.map((b, c) => b[i] ?? " ".repeat(widths[c]!)).join(sep));
  }
  return rows;
}

/**
 * Build the full frame: three hierarchical panels (Lists │ Problems │ Preview)
 * side by side when wide, or just the focused panel full-screen when narrow.
 * Overlays (help/config) and the menu bar take precedence.
 */
export function renderFrame(s: State, rows: number, cols: number): string[] {
  if (s.help) return renderOverlay(HELP_LINES, rows, cols, " help  (? or Esc to close)");
  if (s.config) return renderConfig(s.config, rows, cols);

  const menuBar = renderMenuBar(s, cols);
  const footer = footerLine(s, cols);
  const bodyH = rows - 2; // menu bar + footer

  // Wide: all three panels. Medium: two. Narrow: the focused panel only.
  const three = cols >= 110;
  const two = cols >= 80;

  if (three) {
    const listsW = Math.max(22, Math.floor(cols * 0.22));
    const previewW = Math.max(30, Math.floor(cols * 0.34));
    const problemsW = cols - listsW - previewW - 2; // two separators
    const body = joinColumns(
      [
        listsPanel(s, listsW, bodyH, s.focus === "lists"),
        problemsPanel(s, problemsW, bodyH, s.focus === "problems"),
        previewPanel(s, previewW, bodyH, s.focus === "preview"),
      ],
      bodyH,
      [listsW, problemsW, previewW],
    );
    return [menuBar, ...body, footer];
  }

  if (two) {
    // Show the two panels around the focus: lists+problems, or problems+preview.
    const leftIsLists = s.focus !== "preview";
    const leftW = Math.floor(cols * (leftIsLists ? 0.32 : 0.5));
    const rightW = cols - leftW - 1;
    const left = leftIsLists
      ? listsPanel(s, leftW, bodyH, s.focus === "lists")
      : problemsPanel(s, leftW, bodyH, s.focus === "problems");
    const right = leftIsLists
      ? problemsPanel(s, rightW, bodyH, s.focus === "problems")
      : previewPanel(s, rightW, bodyH, s.focus === "preview");
    const body = joinColumns([left, right], bodyH, [leftW, rightW]);
    return [menuBar, ...body, footer];
  }

  // Narrow: only the focused panel, full width.
  const panel =
    s.focus === "lists"
      ? listsPanel(s, cols, bodyH, true)
      : s.focus === "preview"
        ? previewPanel(s, cols, bodyH, true)
        : problemsPanel(s, cols, bodyH, true);
  return [menuBar, ...panel, footer];
}

/** Render the menu bar to exactly `cols`, highlighting the focused item. */
function renderMenuBar(s: State, cols: number): string {
  const cells = MENU_ITEMS.map((it) => ` ${it.label} `);
  const plainLen = cells.reduce((n, c) => n + c.length, 0) + (cells.length - 1);

  if (s.focus === "menu" && plainLen <= cols) {
    const styled = cells
      .map((c, i) => (i === s.menuIndex ? paint(c, "rev", "bold") : c))
      .join(" ");
    return styled + " ".repeat(cols - plainLen);
  }
  const plain = cells.join(" ");
  return paint(fit(plain, cols), s.focus === "menu" ? "bold" : "dim");
}

/** Render a full-screen overlay from content lines. */
function renderOverlay(content: string[], rows: number, cols: number, title: string): string[] {
  const bodyH = rows - 2;
  const header = paint(fit(title, cols), "bold", "cyan");
  const lines: string[] = [];
  for (let i = 0; i < bodyH; i++) lines.push(fit(content[i] ?? "", cols));
  const footer = paint(fit(" Esc close · q quit", cols), "dim");
  return [header, ...lines, footer];
}

/** Render the settings overlay: one row per editable field, showing current value or fallback. */
function renderConfig(cfg: ConfigState, rows: number, cols: number): string[] {
  const labelW = CONFIG_FIELDS.reduce((w, f) => Math.max(w, f.label.length), 0);
  const content: string[] = ["  Settings", ""];
  CONFIG_FIELDS.forEach((f, i) => {
    const selected = i === cfg.index;
    const marker = selected ? "▸ " : "  ";
    const set = cfg.working[f.key];
    let valueCell: string;
    if (selected && cfg.editing) {
      valueCell = `${cfg.draft}▏`;
    } else if (set) {
      valueCell = set;
    } else {
      valueCell = `(unset — ${f.fallback})`;
    }
    const row = `  ${marker}${f.label.padEnd(labelW)}   ${valueCell}`;
    // Only the value is dimmed when unset; keep the whole selected row reverse-video.
    if (selected) {
      content.push(paint(fit(row, cols), "rev"));
    } else if (set) {
      content.push(row);
    } else {
      content.push(`  ${marker}${f.label.padEnd(labelW)}   ` + paint(`(unset — ${f.fallback})`, "dim"));
    }
  });
  const hint = cfg.editing
    ? " editing  (Enter save field · Esc cancel edit)"
    : " settings  (↑↓ move · Enter edit · x clear · Esc save & close)";
  return renderOverlay(content, rows, cols, hint);
}

/**
 * Copy-pasteable shell command that scaffolds the problem's C++ file
 * (cache-first, so it's instant once cached/prefetched) and opens it in the
 * editor. Kept short so it fits the preview pane without truncation; `-o`
 * (--open) does the editor hand-off in-process.
 */
export function solveCommand(_id: number, slug: string): string {
  return `leet solve ${slug} -o`;
}

function previewHeaderLines(s: State, width: number): string[] {
  const p = current(s);
  if (!p) return [fit("(no problem selected)", width)];
  const lines = [
    paint(fit(`${p.id}. ${p.title}`, width), "bold", "cyan"),
    fit(
      `${paint(p.difficulty, diffColor(p.difficulty))}  ${s.completed.has(p.id) ? paint("✓ done", "green") : ""}`,
      width,
    ),
    paint(fit(p.url, width), "dim"),
    paint(fit(`$ ${solveCommand(p.id, p.slug)}`, width), "green"),
  ];

  // Explain the cross-list popularity — why it's recommended, and where it shows
  // up. Wrapped so long membership lists don't overflow the preview pane.
  const inLists = listsContaining(s, p.id);
  if (inLists.length > 0) {
    const lead = s.showingRecommended
      ? `Recommended — appears in ${inLists.length} list${inLists.length === 1 ? "" : "s"}:`
      : `Appears in ${inLists.length} list${inLists.length === 1 ? "" : "s"}:`;
    lines.push("");
    lines.push(paint(fit(lead, width), s.showingRecommended ? "yellow" : "dim"));
    for (const w of wrapText(inLists.join(", "), Math.max(1, width - 2))) {
      lines.push(paint(fit(`  ${w}`, width), "dim"));
    }
  }
  lines.push("");
  return lines;
}

function previewBody(s: State, width: number): string[] {
  const pv = s.preview;
  if (pv.status === "idle") return [paint(fit("Press Enter to load the statement.", width), "dim")];
  if (pv.status === "loading") return [paint(fit("Loading…", width), "dim")];
  if (pv.status === "error") return [paint(fit(`error: ${pv.error ?? "failed"}`, width), "red")];
  return pv.lines;
}

// ─── runtime ───────────────────────────────────────────────────────────────

async function openUrl(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited;
}

/**
 * Run the interactive TUI. If `list` is omitted, the list picker opens first so
 * the user chooses which list to browse. Resolves when the user quits.
 */
export async function runTui(list?: ProblemList): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`leet tui` needs an interactive terminal (stdin/stdout must be a TTY)");
  }

  const listNames = await availableLists();
  const initial = list ?? (await loadList(listNames[0]!));

  // Preload every list once: powers the Lists panel counts and recommendations.
  const allLists = await Promise.all(
    listNames.map((name) => (name === initial.name ? Promise.resolve(initial) : loadList(name))),
  );
  const listMeta = new Map<string, number[]>();
  for (const l of allLists) listMeta.set(l.name, l.problems.map((p) => p.id));

  const completed = await loadCompleted();
  const config = await loadConfig();
  const recommended = recommendProblems(allLists, config.recommend, {
    completed,
    excludeDone: true,
    limit: 100,
  });
  // First run: suggest pre-caching, opt-in (only when opening bare, no list arg).
  const suggestSetup = !list && !process.env.LEET_NO_SETUP && !(await setupHasRun());

  // Bare launch focuses the Lists panel; an explicit list jumps into Problems.
  const listCursor = list ? Math.max(0, listRows0(listNames, initial.name)) : 0;

  const state: State = {
    list: initial,
    listNames,
    listMeta,
    recommended,
    showingRecommended: false,
    completed,
    doneFilter: "all",
    diff: undefined,
    search: "",
    sortKey: "id",
    sortDesc: false,
    filtered: [],
    cursor: 0,
    top: 0,
    listCursor,
    listTop: 0,
    focus: list ? "problems" : "lists",
    lastPanel: list ? "problems" : "lists",
    menuIndex: 0,
    preview: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: initial.problems.reduce((m, p) => Math.max(m, p.id), 0),
    status: "",
    input: null,
    config: null,
    help: false,
    prefetch: null,
    suggestSetup,
  };
  recompute(state);

  const out = process.stdout;
  const render = (): void => {
    const rows = out.rows ?? 24;
    const cols = out.columns ?? 80;
    out.write("\x1b[H" + renderFrame(state, rows, cols).join("\r\n") + "\x1b[J");
  };

  const previewWidthForCols = (cols: number): number =>
    cols >= 90 ? cols - Math.max(40, Math.floor(cols * 0.5)) - 1 : cols;

  const loadPreview = async (): Promise<void> => {
    const p = current(state);
    if (!p) return;
    if (state.preview.slug === p.slug && state.preview.status === "loaded") return;
    state.preview = { slug: p.slug, status: "loading", lines: [], scroll: 0 };
    render();
    try {
      const remote = await fetchProblem(p.slug, { withContent: true });
      const w = Math.max(10, previewWidthForCols(out.columns ?? 80));
      const text = remote.contentHtml ? htmlToText(remote.contentHtml) : "(no statement available)";
      if (state.preview.slug === p.slug) {
        state.preview = { slug: p.slug, status: "loaded", lines: wrapText(text, w), scroll: 0 };
      }
    } catch (err) {
      if (state.preview.slug === p.slug) {
        state.preview = {
          slug: p.slug,
          status: "error",
          lines: [],
          scroll: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    render();
  };

  const toggleDone = async (): Promise<void> => {
    const p = current(state);
    if (!p) return;
    if (state.completed.has(p.id)) state.completed.delete(p.id);
    else state.completed.add(p.id);
    await saveCompleted(state.completed);
    recompute(state);
    render();
  };

  // Background prefetch of the current view (filtered problems — list or
  // recommended) into the local cache. Non-blocking: updates the footer.
  const startPrefetch = (): void => {
    if (state.prefetch) return; // already running
    const problems = state.filtered.slice();
    if (problems.length === 0) return;
    state.prefetch = `prefetching 0/${problems.length}…`;
    render();
    void prefetchProblems(problems, {
      onProgress: (done, total, slug) => {
        state.prefetch = `prefetching ${done}/${total} — ${slug}`;
        render();
      },
    })
      .then((r) => {
        state.prefetch = `prefetched: ${r.fromRepo} repo, ${r.fromLeet} live, ${r.skipped} cached, ${r.failed} failed`;
        render();
        setTimeout(() => {
          state.prefetch = null;
          render();
        }, 4000);
      })
      .catch(() => {
        state.prefetch = "prefetch failed";
        render();
      });
  };

  // First-run opt-in: pre-cache the suggested study set. Marks setup done so the
  // suggestion never reappears, whether or not the network run fully succeeds.
  const acceptSetup = async (): Promise<void> => {
    state.suggestSetup = false;
    await markSetupDone();
    if (state.prefetch) return;
    let problems;
    try {
      problems = (await loadList(SUGGESTED_SETUP_LIST)).problems.slice();
    } catch {
      return;
    }
    state.prefetch = `pre-caching 0/${problems.length}…`;
    render();
    void prefetchProblems(problems, {
      onProgress: (done, total, slug) => {
        state.prefetch = `pre-caching ${done}/${total} — ${slug}`;
        render();
      },
    })
      .then((r) => {
        state.prefetch = `pre-cached ${SUGGESTED_SETUP_LIST}: ${r.fromRepo + r.fromLeet} cached, ${r.failed} failed`;
        render();
        setTimeout(() => {
          state.prefetch = null;
          render();
        }, 4000);
      })
      .catch(() => {
        state.prefetch = "pre-cache failed";
        render();
      });
  };

  const dismissSetup = async (): Promise<void> => {
    state.suggestSetup = false;
    await markSetupDone();
  };

  const refreshList = async (): Promise<void> => {
    state.status = `refreshing ${state.list.name} (${state.list.problems.length}) from LeetCode…`;
    render();
    let failed = 0;
    const live = await fetchProblems(
      state.list.problems.map((p) => p.slug),
      { onError: () => failed++ },
    );
    let updated = 0;
    for (const p of state.list.problems) {
      const l = live.get(p.slug);
      if (!l) continue;
      if (p.acceptance !== l.acceptance || p.difficulty !== l.difficulty) updated++;
      p.acceptance = l.acceptance;
      p.difficulty = l.difficulty;
    }
    await saveList(state.list);
    recompute(state);
    state.status = `refreshed ${state.list.name}: ${updated} updated, ${failed} failed.`;
    render();
  };

  const openConfig = async (): Promise<void> => {
    const cfg = await loadConfig();
    state.config = { index: 0, editing: false, draft: "", working: { ...cfg } };
    render();
  };

  // Scaffold the current problem's C++ file (cache-first) into the solutions
  // dir. If an editor is configured/available, suspend the TUI, open the file,
  // then restore. Branches off from the Problems/Preview panels via `s`.
  const solveCurrent = async (): Promise<void> => {
    const p = current(state);
    if (!p) return;
    state.status = `scaffolding ${p.slug}…`;
    render();
    const config = await loadConfig();
    const dir = resolveSolutionsDir(undefined, config);
    const path = `${dir}/${scaffoldFilename(p.id, p.slug)}`;
    try {
      let content = await getCached(p.slug);
      if (content === null) {
        const r = await fetchProblem(p.slug, { withSnippets: true, withContent: true });
        content = scaffoldContent({
          id: r.id,
          title: r.title,
          slug: r.slug,
          difficulty: r.difficulty,
          url: `https://leetcode.com/problems/${r.slug}/`,
          snippets: r.snippets ?? [],
          metaData: r.metaData,
          exampleTestcases: r.exampleTestcases,
          contentHtml: r.contentHtml,
        });
        await putCached(p.slug, content);
      }
      await mkdir(dir, { recursive: true });
      if (!(await Bun.file(path).exists())) await Bun.write(path, content);
    } catch (err) {
      state.status = `solve failed: ${err instanceof Error ? err.message : String(err)}`;
      render();
      return;
    }

    const editor = resolveEditor(config) || ["nvim", "vim", "vi"].find((e) => Bun.which(e));
    if (!editor) {
      state.status = `wrote ${path} (set an editor in config to open it)`;
      render();
      return;
    }
    // Suspend the alt-screen, hand the terminal to the editor, then restore.
    out.write("\x1b[?25h\x1b[?1049l");
    process.stdin.setRawMode(false);
    process.stdin.pause();
    const parts = editor.split(/\s+/).filter(Boolean);
    try {
      await Bun.spawn([...parts, path], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
    } catch {
      // ignore editor spawn failure
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    out.write("\x1b[?1049h\x1b[?25l");
    state.status = `edited ${path}`;
    render();
  };

  const closeConfig = async (): Promise<void> => {
    if (!state.config) return;
    const working = state.config.working;
    state.config = null;
    await saveConfig(working);
    state.status = "settings saved.";
    render();
  };

  const runImport = async (source: string): Promise<void> => {
    state.status = `importing from ${source}…`;
    render();
    try {
      const result = await importSource(source);
      const before = state.completed.size;
      for (const id of result.matchedIds) state.completed.add(id);
      const added = state.completed.size - before;
      await saveCompleted(state.completed);
      recompute(state);
      state.status =
        `imported ${source}: ${result.matched.length} matched, ${added} newly marked, ` +
        `${result.unmatched.length} not in any bundled list.`;
    } catch (err) {
      state.status = `import failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    render();
  };

  const activateMenu = (action: MenuAction): void => {
    switch (action) {
      case "filter":
        state.doneFilter = cycleDoneFilter(state.doneFilter);
        recompute(state);
        break;
      case "diff":
        state.diff = cycleDifficulty(state.diff);
        recompute(state);
        break;
      case "sort": {
        const next = cycleSortState(state.sortKey, state.sortDesc);
        state.sortKey = next.key;
        state.sortDesc = next.desc;
        recompute(state);
        break;
      }
      case "search":
        state.input = { kind: "search", value: state.search };
        break;
      case "list":
        // Jump focus to the Lists panel (was a modal picker).
        state.focus = "lists";
        state.lastPanel = "lists";
        break;
      case "open": {
        const p = current(state);
        if (p) void openUrl(p.url);
        break;
      }
      case "refresh":
        void refreshList();
        return;
      case "import":
        state.input = { kind: "import", value: "" };
        break;
      case "config":
        void openConfig();
        return;
      case "help":
        state.help = true;
        break;
    }
    render();
  };

  // ─── terminal setup ───
  out.write("\x1b[?1049h\x1b[?25l"); // alt screen + hide cursor
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const cleanup = (): void => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    out.write("\x1b[?25h\x1b[?1049l"); // show cursor + leave alt screen
  };

  return new Promise<void>((resolve) => {
    const finish = (): void => {
      out.removeListener("resize", render);
      process.stdin.removeListener("data", onData);
      cleanup();
      resolve();
    };

    const previewBodyLen = (): number => previewBody(state, out.columns ?? 80).length;
    const pageStep = (): number => Math.max(1, (out.rows ?? 24) - 4);
    const invalidateStalePreview = (): void => {
      const p = current(state);
      if (p && state.preview.slug !== p.slug && state.focus !== "preview") {
        state.preview = { slug: null, status: "idle", lines: [], scroll: 0 };
      }
    };

    const onData = (buf: Buffer): void => {
      const key = buf.toString("utf8");

      // ── text prompt mode (search / import) ──
      if (state.input) {
        if (key === "\r" || key === "\n") {
          const { kind, value } = state.input;
          state.input = null;
          if (kind === "import" && value.trim()) void runImport(value.trim());
        } else if (key === "\x1b") {
          if (state.input.kind === "search") {
            state.search = "";
            recompute(state);
          }
          state.input = null;
        } else if (key === "\x7f" || key === "\b") {
          state.input.value = state.input.value.slice(0, -1);
          if (state.input.kind === "search") {
            state.search = state.input.value;
            recompute(state);
          }
        } else if (key === "\x03") {
          finish();
          return;
        } else if (key >= " " && !key.startsWith("\x1b")) {
          state.input.value += key;
          if (state.input.kind === "search") {
            state.search = state.input.value;
            recompute(state);
          }
        }
        render();
        return;
      }

      // ── config overlay ── (takes priority; can open over the picker)
      if (state.config) {
        const cfg = state.config;
        const field = CONFIG_FIELDS[cfg.index]!;
        if (cfg.editing) {
          if (key === "\r" || key === "\n") {
            const v = cfg.draft.trim();
            if (v) cfg.working[field.key] = v;
            else delete cfg.working[field.key];
            cfg.editing = false;
          } else if (key === "\x1b") {
            cfg.editing = false; // cancel edit, keep prior value
          } else if (key === "\x7f" || key === "\b") {
            cfg.draft = cfg.draft.slice(0, -1);
          } else if (key === "\x03") {
            finish();
            return;
          } else if (key >= " " && !key.startsWith("\x1b")) {
            cfg.draft += key;
          }
          render();
          return;
        }
        switch (key) {
          case "\x03":
            finish();
            return;
          case "q":
          case "\x1b":
            void closeConfig();
            return;
          case "k":
          case "\x1b[A":
            cfg.index = Math.max(0, cfg.index - 1);
            break;
          case "j":
          case "\x1b[B":
            cfg.index = Math.min(CONFIG_FIELDS.length - 1, cfg.index + 1);
            break;
          case "x":
          case "\x7f":
            delete cfg.working[field.key];
            break;
          case "\r":
          case "\n":
            cfg.editing = true;
            cfg.draft = cfg.working[field.key] ?? "";
            break;
        }
        render();
        return;
      }

      // ── help overlay ──
      if (state.help) {
        if (key === "?" || key === "\x1b" || key === "q") state.help = false;
        render();
        return;
      }

      // ── config overlay handled above; first-run suggestion is modal-lite ──
      if (state.suggestSetup) {
        if (key === "\x03") {
          finish();
          return;
        }
        if (key === "P" || key === "p") {
          void acceptSetup();
          return;
        }
        void dismissSetup(); // then fall through to handle the key normally
      }

      // Ctrl-C / q always quit (except while typing, handled above).
      if (key === "\x03") {
        finish();
        return;
      }

      // ── Tab / Shift-Tab: enter/cycle the menu bar ──
      if (key === "\t" || key === "\x1b[Z") {
        if (state.focus !== "menu") {
          state.lastPanel = state.focus;
          state.focus = "menu";
        } else {
          const dir = key === "\t" ? 1 : -1;
          state.menuIndex = (state.menuIndex + dir + MENU_ITEMS.length) % MENU_ITEMS.length;
        }
        render();
        return;
      }

      // ── menu focus ──
      if (state.focus === "menu") {
        switch (key) {
          case "q":
            finish();
            return;
          case "\x1b": // Esc back to the panel we came from
            state.focus = state.lastPanel;
            break;
          case "h":
          case "\x1b[D":
            state.menuIndex = (state.menuIndex - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
            break;
          case "l":
          case "\x1b[C":
            state.menuIndex = (state.menuIndex + 1) % MENU_ITEMS.length;
            break;
          case "\r":
          case "\n":
            activateMenu(MENU_ITEMS[state.menuIndex]!.action);
            return;
          default:
            return;
        }
        render();
        return;
      }

      // Direct accelerators (menu items) work from any panel. Note `s` is NOT
      // here — it's the contextual "solve" action in the Problems/Preview
      // panels; sort is on `S` to avoid shadowing it.
      const accel: Record<string, MenuAction> = {
        f: "filter",
        d: "diff",
        S: "sort",
        "/": "search",
        L: "list",
        R: "refresh",
        i: "import",
        c: "config",
        "?": "help",
      };
      if (accel[key]) {
        activateMenu(accel[key]!);
        invalidateStalePreview();
        return;
      }

      // ── Lists panel ──
      if (state.focus === "lists") {
        const rows = listRows(state);
        switch (key) {
          case "q":
            finish();
            return;
          case "k":
          case "\x1b[A":
            state.listCursor = Math.max(0, state.listCursor - 1);
            break;
          case "j":
          case "\x1b[B":
            state.listCursor = Math.min(rows.length - 1, state.listCursor + 1);
            break;
          case "g":
            state.listCursor = 0;
            break;
          case "G":
            state.listCursor = rows.length - 1;
            break;
          case "\r":
          case "\n":
          case "\x1b[C": // → drill into the Problems panel
          case "l": {
            const name = rows[state.listCursor]!;
            void selectListRow(state, name).then(() => {
              state.focus = "problems";
              state.lastPanel = "problems";
              render();
            });
            return;
          }
          default:
            return;
        }
        render();
        return;
      }

      // ── Problems panel ──
      if (state.focus === "problems") {
        switch (key) {
          case "q":
            finish();
            return;
          case "k":
          case "\x1b[A":
            state.cursor = Math.max(0, state.cursor - 1);
            invalidateStalePreview();
            break;
          case "j":
          case "\x1b[B":
            state.cursor = Math.min(state.filtered.length - 1, state.cursor + 1);
            invalidateStalePreview();
            break;
          case "\x1b[5~":
            state.cursor = Math.max(0, state.cursor - pageStep());
            invalidateStalePreview();
            break;
          case "\x1b[6~":
            state.cursor = Math.min(state.filtered.length - 1, state.cursor + pageStep());
            invalidateStalePreview();
            break;
          case "g":
            state.cursor = 0;
            invalidateStalePreview();
            break;
          case "G":
            state.cursor = Math.max(0, state.filtered.length - 1);
            invalidateStalePreview();
            break;
          case "\x1b": // ← / Esc back to the Lists panel
          case "\x1b[D":
          case "h":
            state.focus = "lists";
            state.lastPanel = "lists";
            break;
          case "\r":
          case "\n":
          case "\x1b[C": // → drill into Preview
            state.focus = "preview";
            state.lastPanel = "preview";
            void loadPreview();
            return;
          case " ":
            void toggleDone();
            return;
          case "s": // branch off into solve/stub
            void solveCurrent();
            return;
          case "o": {
            const p = current(state);
            if (p) void openUrl(p.url);
            break;
          }
          case "r":
            state.cursor =
              state.filtered.length > 0 ? Math.floor(pseudoRandom() * state.filtered.length) : 0;
            state.status = "";
            invalidateStalePreview();
            break;
          case "p": // preview — same as Enter/→, handy in the compressed one-panel view
            state.focus = "preview";
            state.lastPanel = "preview";
            void loadPreview();
            return;
          case "P": // prefetch the current view into the local cache
            startPrefetch();
            return;
          default:
            return;
        }
        render();
        return;
      }

      // ── Preview panel ──
      if (state.focus === "preview") {
        switch (key) {
          case "q":
            finish();
            return;
          case "\x1b": // ← / Esc back to Problems
          case "\x1b[D":
          case "h":
            state.focus = "problems";
            state.lastPanel = "problems";
            break;
          case "k":
          case "\x1b[A":
            state.preview.scroll = Math.max(0, state.preview.scroll - 1);
            break;
          case "j":
          case "\x1b[B":
            state.preview.scroll = Math.min(Math.max(0, previewBodyLen() - 1), state.preview.scroll + 1);
            break;
          case " ":
            void toggleDone();
            return;
          case "s": // branch off into solve/stub
            void solveCurrent();
            return;
          case "o": {
            const p = current(state);
            if (p) void openUrl(p.url);
            break;
          }
          default:
            return;
        }
        render();
        return;
      }
    };

    out.on("resize", render);
    process.stdin.on("data", onData);
    render();
  });
}

// A tiny non-crypto PRNG for the "random" jump; kept self-contained so the
// test environment's Date/Math.random restrictions never come into play.
let prngState = 0x2545f491;
function pseudoRandom(): number {
  prngState ^= prngState << 13;
  prngState ^= prngState >>> 17;
  prngState ^= prngState << 5;
  return ((prngState >>> 0) % 1_000_000) / 1_000_000;
}
