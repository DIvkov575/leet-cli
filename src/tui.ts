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
import { prefetchProblems } from "./prefetch.ts";

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

/** Full-screen overlay showing a chooseable list of items. */
interface PickerState {
  items: string[];
  index: number;
}

type Focus = "list" | "menu" | "preview";

interface State {
  list: ProblemList;
  listNames: string[];
  /** Problem ids per bundled list, for the picker's unsolved/total counts. */
  listMeta: Map<string, number[]>;
  completed: Set<number>;
  doneFilter: DoneFilter;
  diff: Difficulty | undefined;
  search: string;
  sortKey: SortKey;
  sortDesc: boolean;
  filtered: Problem[];
  cursor: number;
  top: number;
  focus: Focus;
  menuIndex: number;
  preview: PreviewState;
  maxId: number;
  /** Transient message shown in the footer (cleared on next navigation). */
  status: string;
  /** Active text prompt, or null. */
  input: InputState | null;
  /** Active list picker overlay, or null. */
  picker: PickerState | null;
  /** Whether the help overlay is showing. */
  help: boolean;
  /** Live prefetch status shown in the footer; null when idle. */
  prefetch: string | null;
}

function recompute(s: State): void {
  const done = s.doneFilter === "all" ? undefined : s.doneFilter === "done";
  const out = filterProblems(s.list.problems, {
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

/** Load a different bundled list into the state and reset the view. */
async function switchList(s: State, name: string): Promise<void> {
  s.list = await loadList(name);
  s.maxId = s.list.problems.reduce((m, p) => Math.max(m, p.id), 0);
  s.cursor = 0;
  s.top = 0;
  s.preview = { slug: null, status: "idle", lines: [], scroll: 0 };
  s.focus = "list";
  recompute(s);
}

// ─── rendering (pure: state + dims -> lines) ───────────────────────────────

const HELP_LINES = [
  "  leet — key bindings",
  "",
  "  The menu bar (second line) holds every action. Tab / Shift-Tab move",
  "  between items, Enter fires the highlighted one. The arrow keys keep",
  "  scrolling the list even while the menu is focused.",
  "",
  "  Navigation",
  "    ↑ ↓ / j k     move cursor (scroll preview when focused)",
  "    g / G         jump to top / bottom",
  "    PgUp / PgDn   page up / down",
  "    Enter         preview the selected problem",
  "    Space         toggle done (saved immediately)",
  "    Tab / S-Tab   focus / cycle the menu bar",
  "    Esc           leave menu / preview, clear messages",
  "    q             quit",
  "",
  "  Direct shortcuts (same as the menu items)",
  "    f filter   d difficulty   s sort   / search   r random",
  "    L list     o open         R refresh   i import   ? help",
];

/** Build the full frame: exactly `rows` lines, each padded to `cols` columns. */
export function renderFrame(s: State, rows: number, cols: number): string[] {
  if (s.help) return renderOverlay(HELP_LINES, rows, cols, " help  (? or Esc to close)");
  if (s.picker) {
    const nameW = s.picker.items.reduce((w, n) => Math.max(w, n.length), 0);
    const numW = 6; // holds counts up to 6 digits, right-aligned
    const col = (n: number | string): string => String(n).padStart(numW);
    const header = `    ${"".padEnd(nameW)}${col("Done")}${col("Left")}${col("Total")}`;
    const lines = s.picker.items.map((name, i) => {
      const selected = i === s.picker!.index;
      const marker = selected ? "▸ " : "  ";
      const { done, remaining, total } = listCounts(s, name);
      const row = `  ${marker}${name.padEnd(nameW)}${col(done)}${col(remaining)}${col(total)}`;
      return selected ? paint(fit(row, cols), "rev") : row;
    });
    return renderOverlay(
      ["  Choose a list:", paint(header, "dim"), ...lines],
      rows,
      cols,
      " lists  (↑↓ move · Enter open · Esc cancel)",
    );
  }

  const showPreview = cols >= 90;
  const listW = showPreview ? Math.max(40, Math.floor(cols * 0.5)) : cols;
  const previewW = showPreview ? cols - listW - 1 : 0;

  if (s.focus === "preview" && !showPreview) return renderPreviewFull(s, rows, cols);

  const bodyH = rows - 3; // status + menu + footer
  const cols5 = layoutColumns(listW, s.maxId);

  // Line 0 — status: list name, match count, active view settings.
  const settings = [
    `${s.doneFilter}`,
    s.diff ?? "any",
    `${s.sortKey}${s.sortDesc ? "↓" : "↑"}`,
    s.search ? `"${s.search}"` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const status = paint(
    fit(` ${s.list.name}   ${s.filtered.length}/${s.list.problems.length}   ${settings}`, cols),
    "bold",
    "cyan",
  );

  // Line 1 — menu bar.
  const menuBar = renderMenuBar(s, cols);

  // List body.
  s.top = computeTop(s.cursor, s.filtered.length, bodyH, s.top);
  const listLines: string[] = [];
  for (let i = 0; i < bodyH; i++) {
    const idx = s.top + i;
    const p = s.filtered[idx];
    if (!p) {
      listLines.push(" ".repeat(listW));
      continue;
    }
    listLines.push(styleListRow(s, p, idx === s.cursor, cols5, listW));
  }

  // Footer — prompt > prefetch > transient status > minimal hint.
  let footer: string;
  if (s.input) {
    const label = s.input.kind === "search" ? "/" : "import: ";
    footer = paint(fit(` ${label}${s.input.value}▏  (Enter apply · Esc cancel)`, cols), "yellow");
  } else if (s.prefetch) {
    footer = paint(fit(` ${s.prefetch}`, cols), "yellow");
  } else if (s.status) {
    footer = paint(fit(` ${s.status}`, cols), "cyan");
  } else {
    footer = paint(
      fit(" Tab menu · ↑↓ move · Enter preview · Space done · p prefetch · q quit · ? help", cols),
      "dim",
    );
  }

  if (!showPreview) return [status, menuBar, ...listLines, footer];

  // Side-by-side: compose list │ preview per row.
  const previewLines = renderPreviewPane(s, bodyH, previewW);
  const sep = paint("│", "dim");
  const bodyRows: string[] = [];
  for (let i = 0; i < bodyH; i++) {
    bodyRows.push(`${listLines[i]}${sep}${previewLines[i] ?? " ".repeat(previewW)}`);
  }
  return [status, menuBar, ...bodyRows, footer];
}

/**
 * Style one list row to exactly `listW` visible columns. Difficulty is colored
 * per level; selection (reverse) and done (dim) states wrap the whole row while
 * keeping the difficulty color where they coexist.
 */
function styleListRow(s: State, p: Problem, selected: boolean, cols5: Columns, listW: number): string {
  const done = s.completed.has(p.id);
  const statusCell = done ? "✓" : " ";
  const idCell = String(p.id).padStart(cols5.idW);
  const titleCell = fit(p.title, cols5.titleW);
  const accCell = (p.acceptance === null ? "—" : `${p.acceptance.toFixed(1)}%`).padStart(cols5.accW);
  const diffCell = fit(p.difficulty, cols5.diffW);

  const plain = `${statusCell} ${idCell} ${titleCell} ${accCell} ${diffCell}`;
  const pad = " ".repeat(Math.max(0, listW - plain.length));

  if (selected && s.focus === "list") return paint(plain + pad, "rev");
  if (selected) return paint(plain + pad, "bold");

  const prefix = `${statusCell} ${idCell} ${titleCell} ${accCell}`;
  if (done) {
    return paint(prefix, "dim") + " " + paint(diffCell, "dim", diffColor(p.difficulty)) + pad;
  }
  return prefix + " " + paint(diffCell, diffColor(p.difficulty)) + pad;
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
  return [
    paint(fit(`${p.id}. ${p.title}`, width), "bold", "cyan"),
    fit(
      `${paint(p.difficulty, diffColor(p.difficulty))}  ${s.completed.has(p.id) ? paint("✓ done", "green") : ""}`,
      width,
    ),
    paint(fit(p.url, width), "dim"),
    paint(fit(`$ ${solveCommand(p.id, p.slug)}`, width), "green"),
    "",
  ];
}

function previewBody(s: State, width: number): string[] {
  const pv = s.preview;
  if (pv.status === "idle") return [paint(fit("Press Enter to load the statement.", width), "dim")];
  if (pv.status === "loading") return [paint(fit("Loading…", width), "dim")];
  if (pv.status === "error") return [paint(fit(`error: ${pv.error ?? "failed"}`, width), "red")];
  return pv.lines;
}

function renderPreviewPane(s: State, height: number, width: number): string[] {
  const header = previewHeaderLines(s, width);
  const body = previewBody(s, width).slice(s.preview.scroll);
  const focusMark = s.focus === "preview" ? paint(fit("▸ preview", width), "bold") : "";
  const composed = [...header, ...body];
  const lines: string[] = [];
  for (let i = 0; i < height; i++) lines.push(fit(composed[i] ?? "", width));
  if (focusMark && height > 0) lines[height - 1] = focusMark;
  return lines;
}

function renderPreviewFull(s: State, rows: number, cols: number): string[] {
  const bodyH = rows - 2;
  const header = paint(fit(" preview  (Esc back · ↑↓ scroll)", cols), "bold", "cyan");
  const pane = renderPreviewPane(s, bodyH, cols);
  const footer = paint(fit(" Space done · o open · q quit", cols), "dim");
  return [header, ...pane, footer];
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
  // With no explicit list we still need something loaded behind the picker.
  const initial = list ?? (await loadList(listNames[0]!));

  // Preload each list's problem ids so the picker can show unsolved/total.
  const listMeta = new Map<string, number[]>();
  await Promise.all(
    listNames.map(async (name) => {
      const l = name === initial.name ? initial : await loadList(name);
      listMeta.set(name, l.problems.map((p) => p.id));
    }),
  );

  const state: State = {
    list: initial,
    listNames,
    listMeta,
    completed: await loadCompleted(),
    doneFilter: "all",
    diff: undefined,
    search: "",
    sortKey: "id",
    sortDesc: false,
    filtered: [],
    cursor: 0,
    top: 0,
    focus: "list",
    menuIndex: 0,
    preview: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: initial.problems.reduce((m, p) => Math.max(m, p.id), 0),
    status: "",
    input: null,
    // No explicit list → open the picker so nothing is silently "the default".
    picker: list ? null : { items: listNames, index: 0 },
    help: false,
    prefetch: null,
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

  // Background prefetch into the local cache. `page` limits to the currently
  // filtered rows; otherwise the whole list. Non-blocking: updates the footer.
  const startPrefetch = (page: boolean): void => {
    if (state.prefetch) return; // already running
    const problems = page ? state.filtered.slice() : state.list.problems.slice();
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
        state.picker = { items: state.listNames, index: state.listNames.indexOf(state.list.name) };
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

      // ── list picker overlay ──
      if (state.picker) {
        switch (key) {
          case "\x03":
            finish();
            return;
          case "q":
          case "\x1b":
            state.picker = null;
            break;
          case "k":
          case "\x1b[A":
            state.picker.index = Math.max(0, state.picker.index - 1);
            break;
          case "j":
          case "\x1b[B":
            state.picker.index = Math.min(state.picker.items.length - 1, state.picker.index + 1);
            break;
          case "\r":
          case "\n": {
            const name = state.picker.items[state.picker.index]!;
            state.picker = null;
            void switchList(state, name).then(render);
            return;
          }
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

      // ── Tab / Shift-Tab: focus & move through the menu bar ──
      if (key === "\t" || key === "\x1b[Z") {
        if (state.focus !== "menu") {
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
          case "\x03":
          case "q":
            finish();
            return;
          case "\x1b": // Esc back to the list
            state.focus = "list";
            break;
          case "h":
          case "\x1b[D": // left
            state.menuIndex = (state.menuIndex - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
            break;
          case "l":
          case "\x1b[C": // right
            state.menuIndex = (state.menuIndex + 1) % MENU_ITEMS.length;
            break;
          case "k":
          case "\x1b[A": // arrows still scroll the list underneath
            state.cursor = Math.max(0, state.cursor - 1);
            invalidateStalePreview();
            break;
          case "j":
          case "\x1b[B":
            state.cursor = Math.min(state.filtered.length - 1, state.cursor + 1);
            invalidateStalePreview();
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

      // ── preview focus ──
      if (state.focus === "preview") {
        switch (key) {
          case "\x03":
          case "q":
            finish();
            return;
          case "\x1b": // Esc back to list
            state.focus = "list";
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

      // ── list focus ──
      switch (key) {
        case "\x03":
        case "q":
          finish();
          return;
        case "k":
        case "\x1b[A":
          state.cursor = Math.max(0, state.cursor - 1);
          break;
        case "j":
        case "\x1b[B":
          state.cursor = Math.min(state.filtered.length - 1, state.cursor + 1);
          break;
        case "\x1b[5~": // PageUp
          state.cursor = Math.max(0, state.cursor - pageStep());
          break;
        case "\x1b[6~": // PageDown
          state.cursor = Math.min(state.filtered.length - 1, state.cursor + pageStep());
          break;
        case "g":
          state.cursor = 0;
          break;
        case "G":
          state.cursor = Math.max(0, state.filtered.length - 1);
          break;
        case "\r": // Enter: preview the selected problem
        case "\n":
          state.focus = "preview";
          void loadPreview();
          return;
        case " ":
          void toggleDone();
          return;
        case "\x1b": // Esc: clear any transient message, then back to the list picker
          if (state.status) {
            state.status = "";
          } else {
            state.picker = { items: state.listNames, index: state.listNames.indexOf(state.list.name) };
          }
          break;
        // Direct accelerators mirroring the menu items.
        case "r":
          state.cursor =
            state.filtered.length > 0 ? Math.floor(pseudoRandom() * state.filtered.length) : 0;
          state.status = "";
          break;
        case "f":
        case "d":
        case "s":
        case "/":
        case "L":
        case "o":
        case "R":
        case "i":
        case "?": {
          const map: Record<string, MenuAction> = {
            f: "filter",
            d: "diff",
            s: "sort",
            "/": "search",
            L: "list",
            o: "open",
            R: "refresh",
            i: "import",
            "?": "help",
          };
          activateMenu(map[key]!);
          invalidateStalePreview();
          return;
        }
        case "p": // prefetch current (filtered) page into cache
          startPrefetch(true);
          return;
        case "P": // prefetch the whole list into cache
          startPrefetch(false);
          return;
        default:
          return; // ignore unknown keys without redraw
      }
      invalidateStalePreview();
      render();
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
