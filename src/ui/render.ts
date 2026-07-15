/**
 * The TUI render layer: pure `State + dims → string[]` functions. Every panel,
 * overlay, and the full-frame composer live here. No mutation of state beyond
 * the scroll-window bookkeeping (`top`/`listTop`) that render has always owned,
 * and no I/O — so the whole layer is unit-testable via `renderFrame`.
 */
import type { Problem } from "../types.ts";
import { CONFIG_FIELDS, type Config, type ConfigField, type RoadmapSubset } from "../config.ts";
import { NEETCODE_PATTERNS, topicsByPattern } from "../tags.ts";
import {
  roadmapChildren,
  neetcodeChart,
  fullChart,
  type Chart,
  type ChartNode,
} from "../roadmap.ts";
import { fit, paint, diffColor } from "./ansi.ts";
import { layoutColumns, computeTop, wrapText, type Columns } from "./layout.ts";
import { renderMenuBar } from "./menu.ts";
import { solveCommand } from "./controls.ts";
import {
  current,
  currentViewTitle,
  listCounts,
  listRows,
  listsContaining,
  RECOMMENDED_LIST,
  SYNC_ACTIONS,
  type ConfigState,
  type State,
  type SyncState,
} from "./state.ts";

/** Study set suggested for pre-caching on first run. */
export const SUGGESTED_SETUP_LIST = "neetcode-250";

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
  "    F             fullscreen the description + logs (Tab flips, Esc exits)",
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
  "    f filter   d difficulty   T tag       S sort    / search",
  "    m roadmap  L lists        o open      R refresh i import   c config   ? help",
  "",
  "  Tags & roadmap",
  "    T             filter the list by NeetCode pattern (checklist)",
  "    m             open the roadmap — a box flowchart of the patterns;",
  "                  ↑↓←→ move · Enter filters to a pattern · c chart · Tab subset",
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
    const label = s.input.kind === "search" ? "fuzzy /" : "import: ";
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
        ? " ↑↓ move · p/Enter/→ preview · F fullscreen · s solve · t test · Space done · ← lists"
        : s.focus === "preview"
          ? " ↑↓ scroll · F fullscreen · s solve · t test · →/Enter logs · o open · ← back"
          : s.focus === "logs"
            ? " ↑↓ scroll · F fullscreen · t re-run · s solve · Space done · ← preview · Tab menu"
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
  const tagLabel =
    s.tagFilter.size === 0
      ? ""
      : s.tagFilter.size === 1
        ? `#${[...s.tagFilter][0]}`
        : `#${s.tagFilter.size} tags`;
  const settings = [
    `${s.doneFilter}`,
    s.diff ?? "any",
    tagLabel,
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
  if (s.roadmap) return renderRoadmap(s, rows, cols);
  if (s.tagPicker) return renderTagPicker(s, rows, cols);
  if (s.fullscreen) return renderFullscreen(s, rows, cols);

  const menuBar = renderMenuBar(s.focus === "menu", s.menuIndex, cols);
  const footer = footerLine(s, cols);
  const bodyH = rows - 2; // menu bar + footer

  const panels = visiblePanels(s.focus === "menu" ? s.lastPanel : s.focus, cols);
  const seps = panels.length - 1;
  const widths = distributeWidths(panels, cols - seps);
  const blocks = panels.map((name, i) => renderPanelByName(s, name, widths[i]!, bodyH));
  const body = joinColumns(blocks, bodyH, widths);
  return [menuBar, ...body, footer];
}

/**
 * Fullscreen reading mode: the Preview (problem description) and Logs (test
 * results) fill the whole terminal — the Lists/Problems chrome is hidden so the
 * statement gets the full width to reflow into. On a wide terminal both panels
 * show side by side; otherwise only the focused one is shown.
 */
function renderFullscreen(s: State, rows: number, cols: number): string[] {
  const bodyH = rows - 2; // header + footer
  const p = current(s);
  const title = p ? `${p.id}. ${p.title}  [${p.difficulty}]` : "Preview";
  const header = paint(fit(`  ⛶ ${title}`, cols), "bold", "cyan");

  const both = cols >= 100;
  const focusIsLogs = s.focus === "logs";
  let body: string[];
  if (both) {
    const sepCount = 1;
    const previewW = Math.max(20, Math.floor((cols - sepCount) * 0.62));
    const logsW = cols - sepCount - previewW;
    const blocks = [
      previewPanel(s, previewW, bodyH, !focusIsLogs),
      logsPanel(s, logsW, bodyH, focusIsLogs),
    ];
    body = joinColumns(blocks, bodyH, [previewW, logsW]);
  } else {
    body = focusIsLogs
      ? logsPanel(s, cols, bodyH, true)
      : previewPanel(s, cols, bodyH, true);
  }

  const footer = paint(
    fit(
      focusIsLogs
        ? " ↑↓ scroll · t re-run · Tab preview · F/Esc exit fullscreen · q quit"
        : " ↑↓ scroll · s solve · t test · Tab logs · F/Esc exit fullscreen · q quit",
      cols,
    ),
    "dim",
  );
  return [header, ...body.slice(0, bodyH), footer];
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
  const used = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1]! += avail - used;
  return widths;
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
    const excluded = (set as string[] | undefined) ?? [];
    if (excluded.length === 0) return ""; // default → fallback ("all lists included")
    return `all except ${excluded.join(", ")}  (${excluded.length} excluded)`;
  }
  if (field.kind === "boolean") return set ? "on" : "off";
  return (set as string | undefined) ?? "";
}

/**
 * Which config field (if any) offers repo autocomplete. Kept as a helper so the
 * render and key handler agree on when suggestions are live.
 */
export function fieldHasRepoSuggest(field: ConfigField | undefined): boolean {
  return field?.key === "syncRepo";
}

/**
 * Filter repo candidates against the typed draft: case-insensitive substring,
 * ranked so prefix matches come first, then alphabetically. An empty draft
 * shows everything (capped). Exact matches are dropped — no point suggesting
 * what's already typed in full. Pure, so it's unit-tested.
 */
export function filterRepoSuggestions(
  candidates: readonly string[],
  draft: string,
  limit = 8,
): string[] {
  const q = draft.trim().toLowerCase();
  const hits = candidates.filter((r) => {
    const lower = r.toLowerCase();
    return lower.includes(q) && lower !== q;
  });
  hits.sort((a, b) => {
    const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
    return ap !== bp ? ap - bp : a.localeCompare(b);
  });
  return hits.slice(0, limit);
}

/**
 * Done/total problem counts per NeetCode pattern over `source`, optionally
 * scoped to a curated subset (blind75 / neetcode150 / neetcode250). "all" or
 * undefined counts every tagged problem.
 */
function patternCounts(
  source: Problem[],
  completed: Set<number>,
  subset?: RoadmapSubset,
): Map<string, { done: number; total: number }> {
  const counts = new Map<string, { done: number; total: number }>();
  for (const p of source) {
    if (!p.pattern) continue;
    if (subset && subset !== "all" && !(p.subsets ?? []).includes(subset)) continue;
    const c = counts.get(p.pattern) ?? { done: 0, total: 0 };
    c.total++;
    if (completed.has(p.id)) c.done++;
    counts.set(p.pattern, c);
  }
  return counts;
}

/**
 * Tag-picker overlay: a checklist of the 18 NeetCode patterns (checked = in the
 * active filter), with per-pattern done/total counts against the current list.
 */
export function renderTagPicker(s: State, rows: number, cols: number): string[] {
  const source = s.showingRecommended ? s.recommended.map((r) => r.problem) : s.list.problems;
  const counts = patternCounts(source, s.completed);
  const patterns = NEETCODE_PATTERNS;
  const sel = s.tagPicker!.index;
  const content: string[] = ["  Filter by NeetCode pattern", ""];
  patterns.forEach((pat, i) => {
    const on = s.tagFilter.has(pat);
    const box = on ? "[x]" : "[ ]";
    const c = counts.get(pat) ?? { done: 0, total: 0 };
    const tail = c.total > 0 ? `${c.done}/${c.total}` : "—";
    const row = `  ${box} ${pat.padEnd(24)} ${tail}`;
    content.push(i === sel ? paint(fit(row, cols), "rev") : fit(row, cols));
  });
  content.push("");
  content.push(paint(fit("  Space toggle · a all · n none · Enter/Esc apply", cols), "dim"));
  return renderOverlay(content, rows, cols, " Tag filter ");
}

/** A node placed on the grid: its chart node plus horizontal span. */
interface PlacedBox {
  node: ChartNode;
  left: number;
  width: number;
  center: number;
}

/** Centre `text` within `width` columns (pad both sides), truncating if needed. */
function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = width - text.length;
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + text + " ".repeat(pad - left);
}

/**
 * Dynamically size the boxes so a chart fits `cols` nicely: box width scales to
 * the widest row's node count and the longest label, clamped to a readable range.
 */
function roadmapBoxWidth(chart: Chart, cols: number): number {
  const widestRow = Math.max(1, ...chart.rows.map((r) => r.length));
  const longestLabel = Math.max(...chart.rows.flat().map((n) => n.label.length), 4);
  const perSlot = Math.floor((cols - 2) / widestRow) - 1;
  return Math.max(9, Math.min(perSlot, Math.max(longestLabel + 2, 11)));
}

/** Lay out one row of chart nodes as fixed-width boxes evenly spread across `cols`. */
function layoutBoxRow(
  nodes: ChartNode[],
  boxW: number,
  cols: number,
  cursorId: string,
): { boxes: PlacedBox[]; top: string; mid: string; bot: string } {
  const n = nodes.length;
  const inner = boxW - 2;
  const used = n * boxW;
  const gap = Math.max(1, Math.floor((cols - used) / (n + 1)));
  const top = Array(cols).fill(" ");
  const mid = Array(cols).fill(" ");
  const bot = Array(cols).fill(" ");
  const put = (arr: string[], colStart: number, str: string): void => {
    for (let i = 0; i < str.length && colStart + i >= 0 && colStart + i < cols; i++) arr[colStart + i] = str[i]!;
  };
  const boxes: PlacedBox[] = [];
  let x = gap;
  for (const node of nodes) {
    const sel = node.id === cursorId;
    const l = sel ? "▶" : node.kind === "topic" ? "┆" : "│";
    put(top, x, "┌" + "─".repeat(inner) + "┐");
    put(mid, x, l + center(node.label.slice(0, inner), inner) + l);
    put(bot, x, "└" + "─".repeat(inner) + "┘");
    boxes.push({ node, left: x, width: boxW, center: x + Math.floor(boxW / 2) });
    x += boxW + gap;
  }
  return { boxes, top: top.join(""), mid: mid.join(""), bot: bot.join("") };
}

/**
 * A connector row between two placed levels: for each edge whose parent is above
 * and child directly below, drop a `│` from the parent centre and a `v` at the child.
 */
function connectorRow(parents: PlacedBox[], children: PlacedBox[], edges: Array<[string, string]>, cols: number): string {
  const row = Array(cols).fill(" ");
  const parentById = new Map(parents.map((b) => [b.node.id, b]));
  const childById = new Map(children.map((b) => [b.node.id, b]));
  for (const [pid, cid] of edges) {
    const parent = parentById.get(pid);
    const child = childById.get(cid);
    if (!parent || !child) continue;
    if (parent.center >= 0 && parent.center < cols) row[parent.center] = "│";
    if (child.center >= 0 && child.center < cols) row[child.center] = "v";
  }
  return row.join("");
}

/** Colour a laid-out label row: selected reverse-cyan, fully-solved green. */
function colorBoxRow(
  mid: string,
  boxes: PlacedBox[],
  counts: Map<string, { done: number; total: number }>,
  cursorId: string,
): string {
  let out = "";
  let col = 0;
  for (const box of boxes) {
    out += mid.slice(col, box.left);
    const seg = mid.slice(box.left, box.left + box.width);
    const c = counts.get(box.node.pattern) ?? { done: 0, total: 0 };
    if (box.node.id === cursorId) out += paint(seg, "rev", "cyan");
    else if (box.node.kind === "topic") out += paint(seg, "dim");
    else if (c.total > 0 && c.done === c.total) out += paint(seg, "green");
    else out += seg;
    col = box.left + box.width;
  }
  out += mid.slice(col);
  return out;
}

/** The chart for the current roadmap mode (NeetCode DAG or full pattern→topics). */
function roadmapChart(s: State): Chart {
  return s.roadmap!.chart === "full" ? fullChart(topicsByPattern()) : neetcodeChart();
}

/**
 * Roadmap overlay: a top-to-bottom box flowchart. In "neetcode" mode it's the
 * 18-pattern DAG; in "full" mode each pattern also fans out to its LeetCode
 * topics. Counts are over the *global* problem union, scoped to the chosen subset.
 */
export function renderRoadmap(s: State, rows: number, cols: number): string[] {
  const rm = s.roadmap!;
  const counts = patternCounts(s.allProblems, s.completed, rm.subset);
  const chart = roadmapChart(s);
  const flat = chart.rows.flat();
  if (rm.cursor >= flat.length) rm.cursor = 0;
  const cursor = flat[rm.cursor] ?? flat[0]!;

  const c = counts.get(cursor.pattern) ?? { done: 0, total: 0 };
  const unlocks = roadmapChildren(cursor.pattern);
  const chartName = rm.chart === "full" ? "full (pattern→topics)" : "neetcode";
  const detail =
    `  ▶ ${cursor.pattern}` +
    (cursor.kind === "topic" ? ` · topic: ${cursor.label}` : "") +
    (c.total > 0 ? `  ${c.done}/${c.total} done` : "  (none in scope)") +
    (unlocks.length ? `  → ${unlocks.join(", ")}` : "");

  const content: string[] = [
    paint(fit(detail, cols), "cyan"),
    paint(
      fit(`  chart: ${chartName} [c]  ·  subset: ${rm.subset} [Tab]  ·  ↑↓←→ move · Enter study · Esc`, cols),
      "dim",
    ),
    "",
  ];

  const boxW = roadmapBoxWidth(chart, cols);
  let prev: PlacedBox[] | null = null;
  for (const nodes of chart.rows) {
    const { boxes, top, mid, bot } = layoutBoxRow(nodes, boxW, cols, cursor.id);
    if (prev) content.push(connectorRow(prev, boxes, chart.edges, cols));
    content.push(top);
    content.push(colorBoxRow(mid, boxes, counts, cursor.id));
    content.push(bot);
    prev = boxes;
  }
  return renderOverlay(content, rows, cols, " Roadmap ");
}

/** Render the settings overlay: one row per editable field, showing current value or fallback. */
function renderConfig(cfg: ConfigState, rows: number, cols: number): string[] {
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

  let repoSuggesting = false;
  if (cfg.editing && fieldHasRepoSuggest(selectedField)) {
    const matches = filterRepoSuggestions(cfg.repoSuggestions, cfg.draft);
    repoSuggesting = matches.length > 0;
    if (repoSuggesting) {
      content.push("", paint("  matching repos:", "dim"));
      matches.forEach((repo, i) => {
        const row = `    ${repo}`;
        content.push(i === cfg.suggestIndex ? paint(fit(row, cols), "rev") : row);
      });
    } else if (cfg.repoSuggestions.length === 0) {
      content.push("", paint("  (type owner/repo — gh repo list unavailable)", "dim"));
    }
  }

  const hint = cfg.editing
    ? repoSuggesting
      ? " editing  (↑↓ pick · Tab complete · Enter save · Esc cancel)"
      : " editing  (Enter save field · Esc cancel edit)"
    : ` settings  (↑↓ move · Enter ${openVerb} · x clear · Esc save & close)`;
  return renderOverlay(content, rows, cols, hint);
}

/**
 * The checkbox submenu behind a `multiselect` field. Presented as a positive
 * *include* checklist even though the value is stored as the excluded set.
 */
function renderConfigPicker(
  cfg: ConfigState,
  picker: NonNullable<ConfigState["picker"]>,
  rows: number,
  cols: number,
): string[] {
  const excluded = new Set(((cfg.working[picker.key] as string[] | undefined) ?? []).map((n) => n.toLowerCase()));
  const included = (name: string): boolean => !excluded.has(name.toLowerCase());
  const includedCount = picker.choices.filter(included).length;
  const content: string[] = [
    "  Lists in ★ Recommended",
    "",
    paint("  Ticked lists count toward Recommended (default: all).", "dim"),
    paint("  Unticked lists stay browsable but don't vote.", "dim"),
    "",
  ];
  picker.choices.forEach((name, i) => {
    const on = included(name);
    const marker = i === picker.index ? "▸ " : "  ";
    const row = `  ${marker}${on ? "[x]" : "[ ]"} ${name}`;
    if (i === picker.index) content.push(paint(fit(row, cols), "rev"));
    else if (on) content.push(row);
    else content.push(paint(row, "dim"));
  });
  if (picker.choices.length > 0 && includedCount === 0) {
    content.push("");
    content.push(paint("  no lists included — ★ Recommended will be empty", "yellow"));
  }
  return renderOverlay(
    content,
    rows,
    cols,
    " include lists  (↑↓ move · space toggle · a all · n none · Esc back)",
  );
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
    if (selected) content.push(paint(fit(`      ${a.hint}`, cols), "dim"));
  });
  if (sync.lines.length > 0) {
    content.push("", paint(fit("  ─ output ─", cols), "dim"), ...sync.lines.map((l) => `  ${l}`));
  }
  const hint = sync.confirmPush != null
    ? ` push ${sync.confirmPush} solution(s) to your LeetCode account?  (y = submit · n/Esc = cancel)`
    : sync.confirm
      ? ` ${sync.confirm.prompt}  (y = yes · n/Esc = cancel)`
      : sync.busy
        ? " working…  (Esc when done)"
        : " sync  (↑↓ move · Enter run · Esc close)";
  return renderOverlay(content, rows, cols, hint);
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

  // Tags: the NeetCode pattern (with a ~ marker + dim styling when inferred
  // rather than native) plus the LeetCode topic tags. Wrapped to the pane width.
  if (p.pattern || (p.topics && p.topics.length > 0)) {
    lines.push("");
    if (p.pattern) {
      const derived = p.patternSource === "derived";
      const label = `Pattern: ${p.pattern}${derived ? " ~" : ""}`;
      lines.push(paint(fit(label, width), derived ? "dim" : "yellow"));
    }
    if (p.topics && p.topics.length > 0) {
      const wrapped = wrapText(`Topics: ${p.topics.join(", ")}`, Math.max(1, width));
      for (const w of wrapped) lines.push(paint(fit(w, width), "dim"));
    }
  }

  // Explain the cross-list popularity — why it's recommended, and where it shows up.
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

export function previewBody(s: State, width: number): string[] {
  const pv = s.preview;
  if (pv.status === "idle") return [paint(fit("Press Enter to load the statement.", width), "dim")];
  if (pv.status === "loading") return [paint(fit("Loading…", width), "dim")];
  if (pv.status === "error") return [paint(fit(`error: ${pv.error ?? "failed"}`, width), "red")];
  return wrapText(pv.text, Math.max(10, width));
}
