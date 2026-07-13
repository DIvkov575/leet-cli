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
  resolveCxx,
  resolveLeetCodeAuth,
  CONFIG_FIELDS,
  toggleSelection,
  type Config,
  type ConfigField,
  type ConfigKey,
} from "./config.ts";
import { prefetchProblems } from "./prefetch.ts";
import { recommendProblems, excludeLists, type Recommendation } from "./recommend.ts";
import { setupHasRun, markSetupDone } from "./setup.ts";
import { getCached, putCached } from "./cache.ts";
import { scaffoldContent, scaffoldFilename } from "./scaffold.ts";
import { compileAndRun } from "./runner.ts";
import { authFromBrowser } from "./auth.ts";
import { fetchSolvedSlugs } from "./leetcode-progress.ts";
import { submitSolution } from "./leetcode-submit.ts";
import { fetchNeetcodeCpp } from "./neetcode.ts";
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
  { label: "Sort", action: "sort" },
  { label: "Search", action: "search" },
  { label: "List", action: "list" },
  { label: "Open", action: "open" },
  { label: "Refresh", action: "refresh" },
  { label: "Import", action: "import" },
  { label: "Sync", action: "sync" },
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
  /**
   * Open checkbox submenu for a `multiselect` field, or null when the settings
   * list itself has focus. `choices` is supplied by the caller (the bundled
   * list names) so config.ts stays free of any knowledge of what lists exist.
   */
  picker: { key: ConfigKey; choices: string[]; index: number } | null;
}

/** The Sync overlay's three actions, in menu order. */
const SYNC_ACTIONS = [
  { key: "auth", label: "Authenticate", hint: "grab your LeetCode session from a browser" },
  { key: "pull", label: "Pull solved from LeetCode", hint: "mark done what you've solved on your account" },
  { key: "push", label: "Push solutions to LeetCode", hint: "submit NeetCode solutions to mark Accepted" },
] as const;
type SyncAction = (typeof SYNC_ACTIONS)[number]["key"];

/**
 * Sync overlay: a small menu (auth / pull / push) plus a scrolling log of the
 * running action. `busy` blocks re-entry; `confirmPush` gates the destructive
 * push behind an explicit yes.
 */
interface SyncState {
  index: number;
  busy: boolean;
  /** Log lines from the current/last action (progress + results). */
  lines: string[];
  /** When set, push is awaiting y/n confirmation; holds the plan count. */
  confirmPush: number | null;
}

/**
 * The hierarchical panels (lists → problems → preview → logs) plus the bottom
 * menu bar. Tab/→ moves deeper, Shift-Tab/← moves back; the menu is reachable
 * from any panel and returns focus to where it was.
 */
type Focus = "lists" | "problems" | "preview" | "logs" | "menu";

/** Sentinel list name for the "★ Recommended" pseudo-list at the top of Lists. */
const RECOMMENDED_LIST = "★ recommended";

/** Captured test-run state for the Logs panel (beside Preview). */
interface LogsState {
  /** Slug the log belongs to (so it invalidates when the selection changes). */
  slug: string | null;
  status: "idle" | "running" | "done";
  /** Captured compile + run output, line-wrapped for the panel width. */
  lines: string[];
  scroll: number;
  /** Pass/fail summary shown in the panel header once done. */
  summary?: string;
  ok?: boolean;
}

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
  /** Captured output of the last test run, shown in the Logs panel. */
  logs: LogsState;
  maxId: number;
  /** Transient message shown in the footer (cleared on next navigation). */
  status: string;
  /** Active text prompt, or null. */
  input: InputState | null;
  /** Active config overlay, or null. */
  config: ConfigState | null;
  /** Active sync overlay (auth / pull / push), or null. */
  sync: SyncState | null;
  /** Pending push work list, staged between the plan and confirm+run steps. */
  syncWork?: { pr: Problem; code: string }[];
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
  "  Four hierarchical panels: Lists → Problems → Preview → Logs.",
  "  → / Enter drills deeper (open a list, preview a problem, then its",
  "  test logs); ← / Esc steps back out. The menu bar (top) holds every",
  "  action — Tab enters it, ←→ move, Enter fires; Esc returns to your panel.",
  "",
  "  Navigation",
  "    ↑ ↓ / j k     move within the focused panel",
  "    → / Enter     drill in (list → problems → preview → logs)",
  "    p             preview the selected problem (handy in the narrow view)",
  "    ← / Esc       step back out",
  "    g / G         jump to top / bottom",
  "    PgUp / PgDn   page up / down (Problems)",
  "    Space         toggle done (saved immediately)",
  "    s             solve — scaffold the C++ file and open it",
  "    t             test — compile & run the harness, output in Logs",
  "    P             prefetch the current view into the cache (offline)",
  "    Tab           enter the menu bar",
  "    q             quit",
  "",
  "  Direct shortcuts (from any panel)",
  "    f filter   d difficulty   S sort   / search   r random",
  "    L lists    o open         R refresh   i import   c config   ? help",
  "",
  "  Sync (menu bar → Sync): authenticate, pull solved from LeetCode,",
  "  and push solutions to your account (with a confirm before submitting).",
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
        ? " ↑↓ move · p/Enter/→ preview · s solve · t test · Space done · ← lists"
        : s.focus === "preview"
          ? " ↑↓ scroll · s solve · t test · →/Enter logs · o open · ← back"
          : s.focus === "logs"
            ? " ↑↓ scroll · t re-run · s solve · Space done · ← preview · Tab menu"
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

/** The Logs panel: captured compile+run output of the last `t` test run. */
/**
 * Barebones syntax coloring for one captured harness line. Distinguishes the
 * three things worth telling apart at a glance:
 *   - result: "case N:" verdict — PASS green, FAIL/expected red, ran cyan
 *   - output: the "got=" value (and "expected=") — dim labels, plain value
 *   - the summary "P/T passed" line — bold (green if all passed)
 * Anything else (compiler diagnostics, user cout/cerr) is left plain, except
 * lines that look like errors, which are tinted red.
 */
function colorLogLine(line: string): string {
  const m = line.match(/^(case \d+: )(PASS|FAIL|ran)(\s+)(.*)$/);
  if (m) {
    const [, head, verdict, gap, rest] = m;
    const vColor = verdict === "PASS" ? "green" : verdict === "FAIL" ? "red" : "cyan";
    // Dim the got=/expected= labels so the values stand out.
    const body = rest!.replace(/\b(got=|expected=)/g, (lbl) => paint(lbl, "dim"));
    return paint(head!, "dim") + paint(verdict!, vColor) + gap + body;
  }
  if (/^\d+\/\d+ passed$/.test(line.trim())) {
    const [p, t] = line.trim().split("/");
    return paint(line, "bold", p === t?.split(" ")[0] ? "green" : "red");
  }
  if (/\b(error|Error|undefined reference|fatal)\b/.test(line)) return paint(line, "red");
  return line;
}

function logsPanel(s: State, width: number, height: number, focused: boolean): string[] {
  const lg = s.logs;
  const label =
    lg.status === "running"
      ? "Logs — running…"
      : lg.status === "done"
        ? `Logs — ${lg.summary ?? ""}`
        : "Logs";
  // Header color reflects pass/fail once a run finished.
  const head =
    lg.status === "done" && lg.ok === false
      ? paint(fit(`${focused ? "▸ " : "  "}${label}`, width), "bold", "red")
      : lg.status === "done" && lg.ok
        ? paint(fit(`${focused ? "▸ " : "  "}${label}`, width), "bold", "green")
        : panelHeader(label, focused, width);

  const lines = [head];
  const bodyH = height - 1;
  if (lg.status === "idle") {
    lines.push(paint(fit("Press t to compile & run the test harness.", width), "dim"));
    for (let i = lines.length; i <= bodyH; i++) lines.push(fit("", width));
    return lines.slice(0, height);
  }
  if (lg.status === "running") {
    lines.push(paint(fit("Compiling and running…", width), "dim"));
    for (let i = lines.length; i <= bodyH; i++) lines.push(fit("", width));
    return lines.slice(0, height);
  }
  const body = lg.lines.length > 0 ? lg.lines : [paint("(no output)", "dim")];
  const view = body.slice(lg.scroll);
  for (let i = 0; i < bodyH; i++) lines.push(fit(colorLogLine(view[i] ?? ""), width));
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

/** The panel hierarchy, left → right. Focus drills through these in order. */
const PANEL_ORDER = ["lists", "problems", "preview", "logs"] as const;
type PanelName = (typeof PANEL_ORDER)[number];

/** Render one panel by name to the given box. */
function renderPanelByName(s: State, name: PanelName, width: number, height: number): string[] {
  const focused = s.focus === name;
  switch (name) {
    case "lists":
      return listsPanel(s, width, height, focused);
    case "problems":
      return problemsPanel(s, width, height, focused);
    case "preview":
      return previewPanel(s, width, height, focused);
    case "logs":
      return logsPanel(s, width, height, focused);
  }
}

/**
 * Choose the contiguous window of panels to show at `cols`, always including the
 * focused panel and preferring to reveal its ancestors (so the hierarchy reads
 * left→right). ~38 cols per panel; at least one.
 */
function visiblePanels(focus: PanelName, cols: number): PanelName[] {
  const capacity = Math.max(1, Math.min(PANEL_ORDER.length, Math.floor(cols / 38)));
  const focusIdx = PANEL_ORDER.indexOf(focus);
  // Anchor the window so the focused panel is the rightmost when possible,
  // revealing the ancestor chain to its left.
  let start = Math.max(0, focusIdx - (capacity - 1));
  const end = Math.min(PANEL_ORDER.length, start + capacity);
  start = Math.max(0, end - capacity);
  return PANEL_ORDER.slice(start, end);
}

/**
 * Build the full frame: a window of the panel hierarchy
 * (Lists │ Problems │ Preview │ Logs) sized to the terminal, always including
 * the focused panel. Overlays (help/config) and the menu bar take precedence.
 */
export function renderFrame(s: State, rows: number, cols: number): string[] {
  if (s.help) return renderOverlay(HELP_LINES, rows, cols, " help  (? or Esc to close)");
  if (s.config) return renderConfig(s.config, rows, cols);
  if (s.sync) return renderSync(s.sync, rows, cols);

  const menuBar = renderMenuBar(s, cols);
  const footer = footerLine(s, cols);
  const bodyH = rows - 2; // menu bar + footer

  const panels = visiblePanels(s.focus === "menu" ? s.lastPanel : s.focus, cols);
  const seps = panels.length - 1;
  // Give Lists a slim fixed-ish share; split the rest evenly.
  const widths = distributeWidths(panels, cols - seps);
  const blocks = panels.map((name, i) => renderPanelByName(s, name, widths[i]!, bodyH));
  const body = joinColumns(blocks, bodyH, widths);
  return [menuBar, ...body, footer];
}

/** Column widths for the visible panels: Lists gets ~22%, others split evenly. */
function distributeWidths(panels: PanelName[], avail: number): number[] {
  if (panels.length === 1) return [avail];
  const hasLists = panels[0] === "lists";
  const listsW = hasLists ? Math.max(20, Math.floor(avail * 0.22)) : 0;
  const rest = avail - listsW;
  const others = panels.length - (hasLists ? 1 : 0);
  const each = Math.floor(rest / others);
  const widths = panels.map((_, i) => (hasLists && i === 0 ? listsW : each));
  // Give any rounding remainder to the last panel.
  const used = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1]! += avail - used;
  return widths;
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

/**
 * The set value of a field as a display string, or "" when unset. Multiselect
 * fields summarise as "citadel, sig (2 skipped)" rather than dumping an array.
 */
export function configValueCell(field: ConfigField, working: Config): string {
  const set = working[field.key];
  if (field.kind === "multiselect") {
    const picked = (set as string[] | undefined) ?? [];
    if (picked.length === 0) return "";
    return `${picked.join(", ")}  (${picked.length} skipped)`;
  }
  return (set as string | undefined) ?? "";
}

/** Render the settings overlay: one row per editable field, showing current value or fallback. */
function renderConfig(cfg: ConfigState, rows: number, cols: number): string[] {
  // The checkbox submenu takes over the whole overlay while it's open.
  if (cfg.picker) return renderConfigPicker(cfg, cfg.picker, rows, cols);

  const labelW = CONFIG_FIELDS.reduce((w, f) => Math.max(w, f.label.length), 0);
  const content: string[] = ["  Settings", ""];
  CONFIG_FIELDS.forEach((f, i) => {
    const selected = i === cfg.index;
    const marker = selected ? "▸ " : "  ";
    const set = configValueCell(f, cfg.working);
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
  const selectedField = CONFIG_FIELDS[cfg.index];
  const openVerb = selectedField?.kind === "multiselect" ? "choose" : "edit";
  const hint = cfg.editing
    ? " editing  (Enter save field · Esc cancel edit)"
    : ` settings  (↑↓ move · Enter ${openVerb} · x clear · Esc save & close)`;
  return renderOverlay(content, rows, cols, hint);
}

/**
 * The checkbox submenu behind a `multiselect` field. A ticked box means the
 * list is *skipped* — de-selected from the recommendation pool — so the header
 * spells that out; an inverted checklist is exactly the kind of thing people
 * misread.
 */
function renderConfigPicker(
  cfg: ConfigState,
  picker: NonNullable<ConfigState["picker"]>,
  rows: number,
  cols: number,
): string[] {
  const skipped = new Set(((cfg.working[picker.key] as string[] | undefined) ?? []).map((n) => n.toLowerCase()));
  const content: string[] = [
    "  Skip lists in ★ Recommended",
    "",
    paint("  Ticked lists stop counting toward Recommended.", "dim"),
    paint("  They stay browsable in the Lists panel.", "dim"),
    "",
  ];
  picker.choices.forEach((name, i) => {
    const on = skipped.has(name.toLowerCase());
    const marker = i === picker.index ? "▸ " : "  ";
    const row = `  ${marker}${on ? "[x]" : "[ ]"} ${name}`;
    if (i === picker.index) content.push(paint(fit(row, cols), "rev"));
    else if (on) content.push(row);
    else content.push(paint(row, "dim"));
  });
  if (picker.choices.length > 0 && skipped.size === picker.choices.length) {
    content.push("");
    content.push(paint("  every list is skipped — Recommended will be empty", "yellow"));
  }
  return renderOverlay(content, rows, cols, " skip lists  (↑↓ move · space toggle · a none · Esc back)");
}

/** Render the Sync overlay: the action menu, then the running/last action's log. */
function renderSync(sync: SyncState, rows: number, cols: number): string[] {
  const content: string[] = ["  LeetCode Sync", ""];
  SYNC_ACTIONS.forEach((a, i) => {
    const selected = i === sync.index;
    const marker = selected ? "▸ " : "  ";
    const row = `  ${marker}${a.label}`;
    if (selected) content.push(paint(fit(row, cols), "rev"));
    else content.push(row);
    // Show the one-line hint under the selected action.
    if (selected) content.push(paint(fit(`      ${a.hint}`, cols), "dim"));
  });
  if (sync.lines.length > 0) {
    content.push("", paint(fit("  ─ output ─", cols), "dim"), ...sync.lines.map((l) => `  ${l}`));
  }
  const hint = sync.confirmPush !== null
    ? ` push ${sync.confirmPush} solution(s) to your LeetCode account?  (y = submit · n/Esc = cancel)`
    : sync.busy
      ? " working…  (Esc when done)"
      : " sync  (↑↓ move · Enter run · Esc close)";
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
  //
  // In the ★ Recommended view this line is the *justification* for the ranking,
  // so it must be drawn from the same (possibly filtered) pool the ranking used
  // — otherwise a skipped list would still be cited as a reason the problem is
  // recommended. Browsing a real list is a different question ("where else does
  // this appear?"), which is a fact about the whole corpus, so it stays global.
  const rec = s.showingRecommended ? s.recommended.find((r) => r.problem.id === p.id) : undefined;
  const inLists = rec ? rec.lists : listsContaining(s, p.id);
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
  // De-selected lists are dropped from the pool before ranking, so the
  // popularity counts (and the "appears in N lists" line in the preview)
  // reflect only the lists the user actually cares about.
  const rankRecommended = (cfg: Config, done: Set<number>): Recommendation[] =>
    recommendProblems(excludeLists(allLists, cfg.recommendExclude), cfg.recommend, {
      completed: done,
      excludeDone: true,
      limit: 100,
    });

  const recommended = rankRecommended(config, completed);
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
    logs: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: initial.problems.reduce((m, p) => Math.max(m, p.id), 0),
    status: "",
    input: null,
    config: null,
    sync: null,
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

  // Rough width the Logs panel gets; used to pre-wrap captured output.
  const logsWidthForCols = (cols: number): number =>
    Math.max(20, cols >= 110 ? Math.floor(cols * 0.3) : cols);

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
    state.config = { index: 0, editing: false, draft: "", working: { ...cfg }, picker: null };
    render();
  };

  // Scaffold the current problem's C++ file (cache-first) into the solutions
  // dir. If an editor is configured/available, suspend the TUI, open the file,
  // then restore. Branches off from the Problems/Preview panels via `s`.
  // Scaffold the current problem's C++ file to disk (cache-first) and return its
  // path, or null on failure (status is set). Shared by solve and test-run.
  const scaffoldToDisk = async (p: Problem, dir: string): Promise<string | null> => {
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
      return path;
    } catch (err) {
      state.status = `scaffold failed: ${err instanceof Error ? err.message : String(err)}`;
      render();
      return null;
    }
  };

  // Compile + run the current problem's harness, capturing output into the Logs
  // panel. Focuses Logs so the result is visible. Non-blocking on render.
  const runTest = async (): Promise<void> => {
    const p = current(state);
    if (!p) return;
    const config = await loadConfig();
    const dir = resolveSolutionsDir(undefined, config);
    state.logs = { slug: p.slug, status: "running", lines: [], scroll: 0 };
    state.focus = "logs";
    state.lastPanel = "logs";
    render();

    const path = await scaffoldToDisk(p, dir);
    if (path === null) {
      state.logs = { slug: p.slug, status: "done", lines: [state.status], scroll: 0, summary: "scaffold failed", ok: false };
      render();
      return;
    }
    if (!(await Bun.file(path).text()).includes("int main()")) {
      state.logs = {
        slug: p.slug,
        status: "done",
        lines: ["No test harness for this problem (unsupported signature)."],
        scroll: 0,
        summary: "no harness",
        ok: false,
      };
      render();
      return;
    }

    const w = Math.max(10, logsWidthForCols(out.columns ?? 80));
    const result = await compileAndRun(path, resolveCxx(config));
    const wrapped = result.log.split("\n").flatMap((l) => (l ? wrapText(l, w) : [""]));
    const summary = !result.compiled
      ? "compile error"
      : result.ok
        ? "PASS"
        : `FAIL (exit ${result.exitCode})`;
    // Only apply if the selection hasn't moved on.
    if (state.logs.slug === p.slug) {
      state.logs = { slug: p.slug, status: "done", lines: wrapped, scroll: 0, summary, ok: result.ok };
      render();
    }
  };

  const solveCurrent = async (): Promise<void> => {
    const p = current(state);
    if (!p) return;
    state.status = `scaffolding ${p.slug}…`;
    render();
    const config = await loadConfig();
    const dir = resolveSolutionsDir(undefined, config);
    const path = await scaffoldToDisk(p, dir);
    if (path === null) return;

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

    // Ranking settings feed the ★ Recommended pseudo-list, which was computed at
    // startup. Re-rank on close so a change lands immediately instead of waiting
    // for a restart. If the user is *looking* at Recommended, re-point the panel
    // at the new set so the cursor can't dangle past the end of a shorter list.
    state.recommended = rankRecommended(working, state.completed);
    if (state.showingRecommended) await selectListRow(state, RECOMMENDED_LIST);

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

  // ── Sync overlay: auth / pull / push, all running in-panel ──
  const openSync = (): void => {
    state.sync = { index: 0, busy: false, lines: [], confirmPush: null };
    render();
  };
  const syncLog = (line: string): void => {
    if (!state.sync) return;
    state.sync.lines.push(line);
    render();
  };

  const syncAuth = async (): Promise<void> => {
    if (!state.sync) return;
    state.sync.busy = true;
    state.sync.lines = ["Looking for a LeetCode session in your browsers…"];
    render();
    try {
      const { username, from } = await authFromBrowser();
      syncLog(`Signed in as ${username} (from ${from}). Session saved.`);
    } catch (err) {
      for (const l of (err instanceof Error ? err.message : String(err)).split("\n")) syncLog(l);
    }
    state.sync.busy = false;
    render();
  };

  const syncPull = async (): Promise<void> => {
    if (!state.sync) return;
    const auth = resolveLeetCodeAuth(await loadConfig());
    if (!auth) {
      syncLog("No session — run Authenticate first.");
      return;
    }
    state.sync.busy = true;
    state.sync.lines = ["Fetching your solved problems from LeetCode…"];
    render();
    try {
      const result = await importSource("", { adapter: "leetcode", auth });
      const before = state.completed.size;
      for (const id of result.matchedIds) state.completed.add(id);
      const added = state.completed.size - before;
      await saveCompleted(state.completed);
      recompute(state);
      syncLog(
        `${result.matched.length} of ${result.totalSolved} solved are in bundled lists; ` +
          `marked ${added} new.`,
      );
    } catch (err) {
      syncLog(`pull failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    state.sync.busy = false;
    render();
  };

  // Push step 1: resolve the work list (unsolved-on-LeetCode with a solution),
  // then ask for confirmation before any real submission.
  const syncPushPlan = async (): Promise<void> => {
    if (!state.sync) return;
    const auth = resolveLeetCodeAuth(await loadConfig());
    if (!auth || !auth.csrf) {
      syncLog(auth ? "No CSRF token — re-run Authenticate." : "No session — run Authenticate first.");
      return;
    }
    state.sync.busy = true;
    state.sync.lines = ["Checking what's not yet Accepted on LeetCode…"];
    render();
    try {
      const remoteSolved = new Set(await fetchSolvedSlugs(auth));
      const seen = new Set<string>();
      const work: { pr: Problem; code: string }[] = [];
      let premium = 0;
      for (const name of state.listNames) {
        for (const pr of (await loadList(name)).problems) {
          if (seen.has(pr.slug) || remoteSolved.has(pr.slug)) continue;
          seen.add(pr.slug);
          const nc = await fetchNeetcodeCpp(pr.slug);
          if (!nc) continue;
          const meta = await fetchProblem(pr.slug).catch(() => null);
          if (meta?.isPaidOnly) {
            premium++;
            continue;
          }
          work.push({ pr, code: nc.code });
        }
      }
      state.syncWork = work;
      if (premium > 0) syncLog(`Skipping ${premium} Premium-only problem(s).`);
      if (work.length === 0) {
        syncLog("Nothing to push — everything with a solution is already Accepted.");
        state.sync.busy = false;
        render();
        return;
      }
      syncLog(`${work.length} problem(s) ready to submit (e.g. ${work.slice(0, 3).map((w) => w.pr.title).join(", ")}…).`);
      state.sync.busy = false;
      state.sync.confirmPush = work.length;
    } catch (err) {
      syncLog(`push planning failed: ${err instanceof Error ? err.message : String(err)}`);
      state.sync.busy = false;
    }
    render();
  };

  // Push step 2: after confirmation, submit each solution, paced + backoff.
  const syncPushRun = async (): Promise<void> => {
    if (!state.sync) return;
    const auth = resolveLeetCodeAuth(await loadConfig());
    const work = state.syncWork ?? [];
    state.sync.confirmPush = null;
    state.sync.busy = true;
    if (!auth || work.length === 0) {
      state.sync.busy = false;
      render();
      return;
    }
    let accepted = 0;
    let failed = 0;
    for (let i = 0; i < work.length; i++) {
      const { pr, code } = work[i]!;
      syncLog(`[${i + 1}/${work.length}] ${pr.title}…`);
      try {
        const v = await submitSolution(auth, pr.slug, code, { lang: "cpp" });
        if (v.accepted) {
          accepted++;
          state.completed.add(pr.id);
          await saveCompleted(state.completed);
          recompute(state);
        } else {
          failed++;
        }
        state.sync.lines[state.sync.lines.length - 1] =
          `[${i + 1}/${work.length}] ${pr.title} — ${v.accepted ? "Accepted" : v.statusMsg}`;
        render();
      } catch (err) {
        failed++;
        state.sync.lines[state.sync.lines.length - 1] =
          `[${i + 1}/${work.length}] ${pr.title} — error: ${err instanceof Error ? err.message : String(err)}`;
        render();
      }
      if (i < work.length - 1) await new Promise((r) => setTimeout(r, 12_000));
    }
    syncLog(`Done: ${accepted} accepted, ${failed} not accepted.`);
    state.sync.busy = false;
    render();
  };

  const runSyncAction = (action: SyncAction): void => {
    if (!state.sync || state.sync.busy) return;
    if (action === "auth") void syncAuth();
    else if (action === "pull") void syncPull();
    else if (action === "push") void syncPushPlan();
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
      case "sync":
        openSync();
        return;
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
      // The Logs panel is per-problem; reset it when the selection moves off it.
      if (p && state.logs.slug !== p.slug && state.focus !== "logs") {
        state.logs = { slug: null, status: "idle", lines: [], scroll: 0 };
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

        // Checkbox submenu for a multiselect field (e.g. lists to skip in
        // Recommended). Owns all input while open; Esc drops back to Settings.
        if (cfg.picker) {
          const pick = cfg.picker;
          switch (key) {
            case "\x03":
              finish();
              return;
            case "q":
            case "\x1b":
              cfg.picker = null;
              break;
            case "k":
            case "\x1b[A":
              pick.index = Math.max(0, pick.index - 1);
              break;
            case "j":
            case "\x1b[B":
              pick.index = Math.min(pick.choices.length - 1, pick.index + 1);
              break;
            case " ":
            case "\r":
            case "\n": {
              const name = pick.choices[pick.index];
              if (name) {
                const next = toggleSelection(cfg.working[pick.key] as string[] | undefined, name);
                if (next.length > 0) (cfg.working[pick.key] as string[]) = next;
                else delete cfg.working[pick.key];
              }
              break;
            }
            case "a": // clear every tick — back to "all lists count"
              delete cfg.working[pick.key];
              break;
          }
          render();
          return;
        }

        if (cfg.editing) {
          if (key === "\r" || key === "\n") {
            const v = cfg.draft.trim();
            // Only text fields ever enter edit mode; multiselect opens the picker.
            if (v) (cfg.working[field.key] as string) = v;
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
            if (field.kind === "multiselect") {
              // Choices come from the loaded lists, not from config.ts.
              cfg.picker = { key: field.key, choices: [...state.listNames], index: 0 };
            } else {
              cfg.editing = true;
              cfg.draft = (cfg.working[field.key] as string | undefined) ?? "";
            }
            break;
        }
        render();
        return;
      }

      // ── sync overlay ──
      if (state.sync) {
        const sync = state.sync;
        // Push confirmation gate: y submits, n/Esc cancels.
        if (sync.confirmPush !== null) {
          if (key === "y" || key === "Y") {
            void syncPushRun();
          } else if (key === "n" || key === "N" || key === "\x1b") {
            sync.confirmPush = null;
            syncLog("push cancelled.");
          } else if (key === "\x03") {
            finish();
            return;
          }
          render();
          return;
        }
        if (key === "\x03") {
          finish();
          return;
        }
        // While an action runs, only allow Ctrl-C (handled above); ignore others.
        if (sync.busy) return;
        switch (key) {
          case "q":
          case "\x1b":
            state.sync = null;
            break;
          case "k":
          case "\x1b[A":
            sync.index = Math.max(0, sync.index - 1);
            break;
          case "j":
          case "\x1b[B":
            sync.index = Math.min(SYNC_ACTIONS.length - 1, sync.index + 1);
            break;
          case "\r":
          case "\n":
            runSyncAction(SYNC_ACTIONS[sync.index]!.key);
            return;
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
          case "t": // compile & run the test harness, show output in Logs
            void runTest();
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
          case "\x1b[C": // → drill into the Logs panel
          case "l":
          case "\r":
          case "\n":
            state.focus = "logs";
            state.lastPanel = "logs";
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
          case "t": // compile & run the harness → Logs
            void runTest();
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

      // ── Logs panel ──
      if (state.focus === "logs") {
        const maxScroll = Math.max(0, state.logs.lines.length - 1);
        switch (key) {
          case "q":
            finish();
            return;
          case "\x1b": // ← / Esc back to Preview
          case "\x1b[D":
          case "h":
            state.focus = "preview";
            state.lastPanel = "preview";
            break;
          case "k":
          case "\x1b[A":
            state.logs.scroll = Math.max(0, state.logs.scroll - 1);
            break;
          case "j":
          case "\x1b[B":
            state.logs.scroll = Math.min(maxScroll, state.logs.scroll + 1);
            break;
          case "g":
            state.logs.scroll = 0;
            break;
          case "G":
            state.logs.scroll = maxScroll;
            break;
          case "t": // re-run the test
            void runTest();
            return;
          case "s":
            void solveCurrent();
            return;
          case " ":
            void toggleDone();
            return;
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
