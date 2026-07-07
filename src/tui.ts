import type { Difficulty, Problem, ProblemList } from "./types.ts";
import { filterProblems } from "./lib.ts";
import { fetchProblem } from "./leetcode.ts";
import { htmlToText } from "./render.ts";
import { loadCompleted, saveCompleted } from "./progress.ts";
import { prefetchProblems } from "./prefetch.ts";

/**
 * Interactive full-screen browser for a bundled list. Unlike the one-shot
 * `ls` command this redraws on every keystroke: filter by done/todo, navigate,
 * toggle completion, and Tab into a preview pane that lazily fetches the live
 * problem statement. All layout math is in pure exported helpers so it can be
 * unit-tested without a real terminal.
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

/** Truncate to `width` display columns, marking cuts with a trailing "…". */
export function truncate(s: string, width: number): string {
  if (width <= 0) return "";
  if (s.length <= width) return s;
  if (width === 1) return "…";
  return s.slice(0, width - 1) + "…";
}

/** Pad (right) or truncate to exactly `width` columns. */
export function fit(s: string, width: number): string {
  if (width <= 0) return "";
  const t = truncate(s, width);
  return t + " ".repeat(width - t.length);
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

interface State {
  list: ProblemList;
  completed: Set<number>;
  doneFilter: DoneFilter;
  diff: Difficulty | undefined;
  search: string;
  searching: boolean;
  filtered: Problem[];
  cursor: number;
  top: number;
  focus: "list" | "preview";
  preview: PreviewState;
  maxId: number;
  /** Live prefetch status shown in the footer; null when idle. */
  prefetch: string | null;
}

function recompute(s: State): void {
  const done = s.doneFilter === "all" ? undefined : s.doneFilter === "done";
  s.filtered = filterProblems(s.list.problems, {
    difficulty: s.diff,
    search: s.search || undefined,
    completed: s.completed,
    done,
  });
  if (s.cursor >= s.filtered.length) s.cursor = Math.max(0, s.filtered.length - 1);
}

function current(s: State): Problem | undefined {
  return s.filtered[s.cursor];
}

// ─── rendering (pure: state + dims -> lines) ───────────────────────────────

/** Build the full frame: exactly `rows` lines, each padded to `cols` columns. */
export function renderFrame(s: State, rows: number, cols: number): string[] {
  const showPreview = cols >= 90;
  const listW = showPreview ? Math.max(40, Math.floor(cols * 0.5)) : cols;
  const previewW = showPreview ? cols - listW - 1 : 0;

  const bodyH = rows - 2; // header + footer
  const cols5 = layoutColumns(listW, s.maxId);

  // Header.
  const filterBits = [
    `filter:${s.doneFilter}`,
    `diff:${s.diff ?? "any"}`,
    s.search ? `search:"${s.search}"` : "",
  ]
    .filter(Boolean)
    .join("  ");
  const header = fit(
    ` ${s.list.title}  ${s.filtered.length}/${s.list.problems.length}  ${filterBits}`,
    cols,
  );

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
    const isDone = s.completed.has(p.id);
    const selected = idx === s.cursor;
    const status = isDone ? "✓" : " ";
    const accStr = p.acceptance === null ? "—" : `${p.acceptance.toFixed(1)}%`;
    const raw =
      `${status} ` +
      `${String(p.id).padStart(cols5.idW)} ` +
      `${fit(p.title, cols5.titleW)} ` +
      `${accStr.padStart(cols5.accW)} ` +
      `${fit(p.difficulty, cols5.diffW)}`;
    const line = fit(raw, listW);
    if (selected && s.focus === "list") listLines.push(paint(line, "rev"));
    else if (selected) listLines.push(paint(line, "bold"));
    else if (isDone) listLines.push(paint(line, "dim"));
    else listLines.push(line);
  }

  // Footer / hint or search prompt.
  let footer: string;
  if (s.searching) {
    footer = fit(` /${s.search}▏  (Enter apply · Esc cancel)`, cols);
    footer = paint(footer, "yellow");
  } else if (s.prefetch) {
    footer = paint(fit(` ${s.prefetch}`, cols), "yellow");
  } else {
    footer = paint(
      fit(
        " ↑↓/jk move · Space done · f filter · d diff · / search · Tab preview · p prefetch · o open · q quit",
        cols,
      ),
      "dim",
    );
  }

  if (!showPreview) {
    // Preview as full-screen overlay when focused and there's content/loading.
    if (s.focus === "preview") {
      return renderPreviewFull(s, rows, cols);
    }
    return [paint(header, "bold", "cyan"), ...listLines, footer];
  }

  // Side-by-side: compose list | preview per row.
  const previewLines = renderPreviewPane(s, bodyH, previewW);
  const bodyRows: string[] = [];
  const sep = paint("│", "dim");
  for (let i = 0; i < bodyH; i++) {
    bodyRows.push(`${listLines[i]}${sep}${previewLines[i] ?? " ".repeat(previewW)}`);
  }
  const headerFull = paint(header, "bold", "cyan");
  return [headerFull, ...bodyRows, footer];
}

function previewHeaderLines(s: State, width: number): string[] {
  const p = current(s);
  if (!p) return [fit("(no problem selected)", width)];
  const head = [
    paint(fit(`${p.id}. ${p.title}`, width), "bold", "cyan"),
    fit(`${paint(p.difficulty, diffColor(p.difficulty))}  ${s.completed.has(p.id) ? paint("✓ done", "green") : ""}`, width),
    paint(fit(p.url, width), "dim"),
    "",
  ];
  return head;
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
  const header = paint(fit(" preview  (Tab/Esc back · ↑↓ scroll)", cols), "bold", "cyan");
  const pane = renderPreviewPane(s, bodyH, cols);
  const footer = paint(fit(" Enter load · Space done · o open · q quit", cols), "dim");
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

/** Run the interactive TUI for a loaded list. Resolves when the user quits. */
export async function runTui(list: ProblemList): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`leet tui` needs an interactive terminal (stdin/stdout must be a TTY)");
  }

  const state: State = {
    list,
    completed: await loadCompleted(),
    doneFilter: "all",
    diff: undefined,
    search: "",
    searching: false,
    filtered: [],
    cursor: 0,
    top: 0,
    focus: "list",
    preview: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: list.problems.reduce((m, p) => Math.max(m, p.id), 0),
    prefetch: null,
  };
  recompute(state);

  const out = process.stdout;
  const render = (): void => {
    const rows = out.rows ?? 24;
    const cols = out.columns ?? 80;
    const frame = renderFrame(state, rows, cols);
    out.write("\x1b[H" + frame.join("\r\n") + "\x1b[J");
  };

  // Preview width depends on layout; recompute wrap on load using current cols.
  const loadPreview = async (): Promise<void> => {
    const p = current(state);
    if (!p) return;
    if (state.preview.slug === p.slug && state.preview.status === "loaded") return;
    state.preview = { slug: p.slug, status: "loading", lines: [], scroll: 0 };
    render();
    try {
      const remote = await fetchProblem(p.slug, { withContent: true });
      const cols = out.columns ?? 80;
      const w = cols >= 90 ? cols - Math.max(40, Math.floor(cols * 0.5)) - 1 : cols;
      const text = remote.contentHtml ? htmlToText(remote.contentHtml) : "(no statement available)";
      if (state.preview.slug === p.slug) {
        state.preview = { slug: p.slug, status: "loaded", lines: wrapText(text, Math.max(10, w)), scroll: 0 };
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

    const onData = (buf: Buffer): void => {
      const key = buf.toString("utf8");

      // ── search input mode ──
      if (state.searching) {
        if (key === "\r" || key === "\n") {
          state.searching = false;
        } else if (key === "\x1b") {
          state.searching = false;
          state.search = "";
          recompute(state);
        } else if (key === "\x7f" || key === "\b") {
          state.search = state.search.slice(0, -1);
          recompute(state);
        } else if (key === "\x03") {
          finish();
          return;
        } else if (key >= " " && !key.startsWith("\x1b")) {
          state.search += key;
          recompute(state);
        }
        render();
        return;
      }

      switch (key) {
        case "\x03": // Ctrl-C
        case "q":
          finish();
          return;
        case "k":
        case "\x1b[A": // up
          if (state.focus === "preview") state.preview.scroll = Math.max(0, state.preview.scroll - 1);
          else state.cursor = Math.max(0, state.cursor - 1);
          break;
        case "j":
        case "\x1b[B": // down
          if (state.focus === "preview")
            state.preview.scroll = Math.min(Math.max(0, previewBodyLen() - 1), state.preview.scroll + 1);
          else state.cursor = Math.min(state.filtered.length - 1, state.cursor + 1);
          break;
        case "\x1b[5~": // PageUp
          state.cursor = Math.max(0, state.cursor - ((out.rows ?? 24) - 3));
          break;
        case "\x1b[6~": // PageDown
          state.cursor = Math.min(state.filtered.length - 1, state.cursor + ((out.rows ?? 24) - 3));
          break;
        case "g":
          state.cursor = 0;
          break;
        case "G":
          state.cursor = Math.max(0, state.filtered.length - 1);
          break;
        case "f":
          state.doneFilter = cycleDoneFilter(state.doneFilter);
          recompute(state);
          break;
        case "d":
          state.diff = cycleDifficulty(state.diff);
          recompute(state);
          break;
        case "/":
          state.searching = true;
          break;
        case " ":
          void toggleDone();
          return;
        case "\t": // Tab: toggle focus into/out of preview
        case "\x1b[Z":
          state.focus = state.focus === "list" ? "preview" : "list";
          if (state.focus === "preview" && state.preview.status === "idle") void loadPreview();
          break;
        case "\r": // Enter: load preview + focus it
        case "\n":
          state.focus = "preview";
          void loadPreview();
          return;
        case "\x1b": // Esc: leave preview focus
          state.focus = "list";
          break;
        case "o": {
          const p = current(state);
          if (p) void openUrl(p.url);
          break;
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
      // Changing the selected row invalidates the preview if not loaded for it.
      const p = current(state);
      if (p && state.preview.slug !== p.slug && state.focus === "list") {
        state.preview = { slug: null, status: "idle", lines: [], scroll: 0 };
      }
      render();
    };

    out.on("resize", render);
    process.stdin.on("data", onData);
    render();
  });
}
