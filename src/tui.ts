import type { Problem, ProblemList } from "./types.ts";
import { availableLists, loadList, ALL_LIST_NAME } from "./lib.ts";
import { loadCompleted } from "./progress.ts";
import { loadConfig, type Config } from "./config.ts";
import { recommendProblems, excludeLists, type Recommendation } from "./recommend.ts";
import { setupHasRun } from "./setup.ts";
import { EMBEDDED_ARTIFACTS } from "./artifacts.ts";
import { recompute, listRows0, type State } from "./ui/state.ts";
import { renderFrame } from "./ui/render.ts";
import { createActions } from "./ui/actions.ts";
import { createInputHandler } from "./ui/input.ts";
import type { TuiContext } from "./ui/context.ts";

// Re-exported so the public surface (what tests import from ./tui.ts) is
// unchanged after the decomposition into ui/ modules.
export { visibleLength, truncate, fit, type Columns } from "./ui/ansi.ts";
export { layoutColumns, computeTop, wrapText } from "./ui/layout.ts";
export { menuWindow, MENU_ITEMS, type MenuAction, type MenuItem } from "./ui/menu.ts";
export {
  cycleDoneFilter,
  cycleDifficulty,
  cycleSortState,
  solveCommand,
  type DoneFilter,
} from "./ui/controls.ts";
export { renderFrame, filterRepoSuggestions, configValueCell, renderTagPicker, renderRoadmap } from "./ui/render.ts";

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

// ─── runtime ───────────────────────────────────────────────────────────────

/**
 * Whether the compiled-in artifact bundle actually holds problem data. True on
 * any real build (the bundle ships hundreds of problems); false only for a dev
 * run against an empty/placeholder bundle, where the pre-cache prompt still helps.
 */
function bundleCoversStudySet(): boolean {
  return Object.keys(EMBEDDED_ARTIFACTS).length > 0;
}

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
  // The Lists panel opens on the synthetic "all" list unless a specific list
  // was requested; the picker (Lists panel) switches from there.
  const initial = list ?? (await loadList(ALL_LIST_NAME));

  // Preload every real list once: powers the Lists panel counts and rankings.
  const allLists = await Promise.all(listNames.map((name) => loadList(name)));
  const listMeta = new Map<string, number[]>();
  for (const l of allLists) listMeta.set(l.name, l.problems.map((p) => p.id));
  // The synthetic "all" list's counts come from the de-duped union of every id.
  listMeta.set(ALL_LIST_NAME, [...new Set(allLists.flatMap((l) => l.problems.map((p) => p.id)))]);
  // De-duplicated union of every problem (by id), for the global roadmap counts.
  const allProblemsById = new Map<number, Problem>();
  for (const l of allLists) for (const p of l.problems) if (!allProblemsById.has(p.id)) allProblemsById.set(p.id, p);
  const allProblems = [...allProblemsById.values()];

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
  // Every bundled problem's statement + scaffold ships embedded in the binary
  // (see artifacts.ts), so a fresh install is already offline-ready — there's
  // nothing to pre-cache. The opt-in prompt only appears if that bundle is
  // somehow unavailable (e.g. a dev run against an empty bundle).
  const suggestSetup =
    !list && !process.env.LEET_NO_SETUP && !bundleCoversStudySet() && !(await setupHasRun());

  // Bare launch focuses the Lists panel; an explicit list jumps into Problems.
  const initialListName = initial.name;

  const state: State = {
    list: initial,
    listNames,
    allProblems,
    listMeta,
    recommended,
    showingRecommended: false,
    completed,
    doneFilter: "all",
    diff: undefined,
    tagFilter: new Set<string>(),
    tagPicker: null,
    roadmap: null,
    search: "",
    sortKey: "id",
    sortDesc: false,
    filtered: [],
    cursor: 0,
    top: 0,
    listCursor: 0,
    listTop: 0,
    // Both bare launch and an explicit list open straight into the Problems
    // panel; bare launch defaults to the "All Problems" union (`initial`).
    focus: "problems",
    lastPanel: "problems",
    menuIndex: 0,
    preview: { slug: null, status: "idle", text: "", scroll: 0 },
    logs: { slug: null, status: "idle", lines: [], scroll: 0 },
    maxId: initial.problems.reduce((m, p) => Math.max(m, p.id), 0),
    status: "",
    input: null,
    config: null,
    sync: null,
    help: false,
    prefetch: null,
    suggestSetup,
    fullscreen: false,
  };
  // Place the Lists cursor on whichever list is showing (the requested one, or
  // "all" for a bare launch) so stepping back (←) highlights the right row.
  state.listCursor = listRows0(state, initialListName);
  recompute(state);

  const out = process.stdout;
  const render = (): void => {
    const rows = out.rows ?? 24;
    const cols = out.columns ?? 80;
    out.write("\x1b[H" + renderFrame(state, rows, cols).join("\r\n") + "\x1b[J");
  };

  // Shared context threaded into the action + input modules. `onData`/`finish`
  // are filled in once the handlers exist (they reference each other).
  const ctx: TuiContext = { state, render, out, config, rankRecommended, onData: null, finish: () => {} };
  const actions = createActions(ctx);
  const onData = createInputHandler(ctx, actions);
  ctx.onData = onData;

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
    ctx.finish = finish;

    out.on("resize", render);
    process.stdin.on("data", onData);
    render();
  });
}

