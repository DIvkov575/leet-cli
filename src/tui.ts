import type { Problem, ProblemList } from "./types.ts";
import {
  availableLists,
  browsableLists,
  loadList,
  saveList,
  ALL_LIST_NAME,
} from "./lib.ts";
import { fetchProblem, fetchProblems } from "./leetcode.ts";
import { resolveDescription } from "./description.ts";
import { listUserRepos } from "./repo.ts";
import { importSource } from "./import.ts";
import { loadCompleted, saveCompleted } from "./progress.ts";
import {
  loadConfig,
  saveConfig,
  resolveEditor,
  resolveSolutionsDir,
  resolveCxx,
  resolveLeetCodeAuth,
  resolveSyncRepo,
  resolveRoadmapChart,
  resolveRoadmapSubset,
  ROADMAP_CHARTS,
  ROADMAP_SUBSETS,
  CONFIG_FIELDS,
  toggleSelection,
  type Config,
} from "./config.ts";
import { setConfigOffline } from "./net.ts";
import { prefetchProblems } from "./prefetch.ts";
import { recommendProblems, excludeLists, type Recommendation } from "./recommend.ts";
import { setupHasRun, markSetupDone } from "./setup.ts";
import { scaffoldContent, scaffoldFilename } from "./scaffold.ts";
import { buildSolutionFile, hasStatementBlock, withStatement } from "./solution-file.ts";
import { compileAndRun } from "./runner.ts";
import { NEETCODE_PATTERNS, topicsByPattern } from "./tags.ts";
import { neetcodeChart, fullChart, chartMove } from "./roadmap.ts";
import { authFromBrowser } from "./auth.ts";
import { fetchSolvedSlugs } from "./leetcode-progress.ts";
import { submitSolution } from "./leetcode-submit.ts";
import { fetchNeetcodeCpp } from "./neetcode.ts";
import { mkdir } from "node:fs/promises";
// UI modules. The runtime below owns a single State and mutates it through the
// state helpers; the render layer turns it into frames.
import { fit } from "./ui/ansi.ts";
import { wrapText } from "./ui/layout.ts";
import { MENU_ITEMS, menuWindow, type MenuAction } from "./ui/menu.ts";
import { cycleDoneFilter, cycleDifficulty, cycleSortState, solveCommand } from "./ui/controls.ts";
import {
  recompute,
  current,
  listRows,
  listRows0,
  selectListRow,
  RECOMMENDED_LIST,
  SYNC_ACTIONS,
  type State,
  type SyncAction,
} from "./ui/state.ts";
import {
  renderFrame,
  filterRepoSuggestions,
  fieldHasRepoSuggest,
  SUGGESTED_SETUP_LIST,
} from "./ui/render.ts";

// Re-exported so the public surface (what tests import from ./tui.ts) is
// unchanged after the extraction into ui/ modules.
export {
  visibleLength,
  truncate,
  fit,
  type Columns,
} from "./ui/ansi.ts";
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
  // First run: suggest pre-caching, opt-in (only when opening bare, no list arg).
  const suggestSetup = !list && !process.env.LEET_NO_SETUP && !(await setupHasRun());

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
    focus: list ? "problems" : "lists",
    lastPanel: list ? "problems" : "lists",
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
  // An explicit list arg starts with the Lists cursor on that row (bare launch
  // leaves it on ★ Recommended at index 0).
  if (list) state.listCursor = listRows0(state, initialListName);
  recompute(state);

  const out = process.stdout;
  const render = (): void => {
    const rows = out.rows ?? 24;
    const cols = out.columns ?? 80;
    out.write("\x1b[H" + renderFrame(state, rows, cols).join("\r\n") + "\x1b[J");
  };

  // Rough width the Logs panel gets; used to pre-wrap captured output.
  const logsWidthForCols = (cols: number): number =>
    Math.max(20, cols >= 110 ? Math.floor(cols * 0.3) : cols);

  // Resolve the statement cache-first (local cache → synced repo .md → live
  // LeetCode), so a preview only ever hits LeetCode for a problem that has
  // never been synced or seen. The raw text is stored and wrapped at render
  // time, which lets the fullscreen view reflow to the full terminal width.
  const loadPreview = async (): Promise<void> => {
    const p = current(state);
    if (!p) return;
    if (state.preview.slug === p.slug && state.preview.status === "loaded") return;
    state.preview = { slug: p.slug, status: "loading", text: "", scroll: 0 };
    render();
    try {
      const { text, source } = await resolveDescription(p);
      if (state.preview.slug === p.slug) {
        state.preview = { slug: p.slug, status: "loaded", text, scroll: 0, source };
      }
    } catch (err) {
      if (state.preview.slug === p.slug) {
        state.preview = {
          slug: p.slug,
          status: "error",
          text: "",
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
    // The ★ Recommended pseudo-list and the synthetic "all" union aren't real,
    // savable lists — refresh a concrete list instead.
    if (state.showingRecommended || state.list.name === ALL_LIST_NAME) {
      state.status = "pick a specific list to refresh (Recommended/All are computed views).";
      render();
      return;
    }
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
    state.config = {
      index: 0,
      editing: false,
      draft: "",
      working: { ...cfg },
      picker: null,
      repoSuggestions: [],
      suggestIndex: 0,
    };
    render();
    // Fetch the user's repos in the background for the sync-repo autocomplete;
    // degrade silently to a plain text field if gh isn't available.
    void listUserRepos().then((repos) => {
      if (state.config) state.config.repoSuggestions = repos;
      render();
    });
  };

  // Scaffold the current problem's C++ file (cache-first) into the solutions
  // dir. If an editor is configured/available, suspend the TUI, open the file,
  // then restore. Branches off from the Problems/Preview panels via `s`.
  // Scaffold the current problem's C++ file to disk (cache-first) and return its
  // path, or null on failure (status is set). Shared by solve and test-run.
  const scaffoldToDisk = async (p: Problem, dir: string): Promise<string | null> => {
    const path = `${dir}/${scaffoldFilename(p.id, p.slug)}`;
    try {
      // Shared, statement-guaranteed builder (cache-first, heals stale cache).
      const content = await buildSolutionFile(p, async () => {
        const r = await fetchProblem(p.slug, { withSnippets: true, withContent: true });
        return scaffoldContent({
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
      });
      await mkdir(dir, { recursive: true });
      if (!(await Bun.file(path).exists())) {
        await Bun.write(path, content);
      } else {
        // Heal an existing on-disk file that predates statement-embedding.
        const existing = await Bun.file(path).text();
        if (!hasStatementBlock(existing)) {
          const stmt = await resolveDescription(p).then((r) => r.text).catch(() => "");
          if (stmt) await Bun.write(path, withStatement(existing, stmt));
        }
      }
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
    // Re-prime the network gate in case offline mode was toggled in-session.
    setConfigOffline(working.offline);

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
    state.sync = { index: 0, busy: false, lines: [], confirmPush: null, confirm: null };
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

  // Mark problems done from the folders present in the configured sync repo
  // (NeetCode-style layout). No LeetCode session needed — this only reads the
  // repo's git tree via gh and marks matches done locally.
  const syncMarkRepo = async (): Promise<void> => {
    if (!state.sync) return;
    const repo = resolveSyncRepo(undefined, await loadConfig());
    if (!repo) {
      syncLog("No sync repo configured — set `syncRepo` in Config (or `leet sync-repo adopt <owner/repo>`).");
      return;
    }
    state.sync.busy = true;
    state.sync.lines = [`Reading solved problems from ${repo}…`];
    render();
    try {
      const result = await importSource(repo, { adapter: "neetcode" });
      const before = state.completed.size;
      for (const id of result.matchedIds) state.completed.add(id);
      const added = state.completed.size - before;
      await saveCompleted(state.completed);
      recompute(state);
      syncLog(
        `${result.matched.length} of ${result.totalSolved} folders matched bundled problems; ` +
          `marked ${added} new.`,
      );
    } catch (err) {
      syncLog(`mark-solved failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    state.sync.busy = false;
    render();
  };

  // Re-invoke `leet <args>` as a child process with the terminal handed over
  // (suspending the alt-screen), so long git/network operations show their live
  // output and can't corrupt the TUI frame. Works both compiled (a single
  // executable argv[0]) and under `bun run` (argv = [bun, cli.ts, …]). Returns
  // the child's exit code; -1 if it couldn't be spawned.
  const runLeetInShell = async (args: string[]): Promise<number> => {
    // process.argv[1] is cli.ts under `bun run`; undefined-ish when compiled.
    const self = process.argv[1];
    const cmd =
      self && self.endsWith(".ts")
        ? [process.execPath, self, ...args] // bun run src/cli.ts …
        : [process.execPath, ...args]; // compiled standalone binary
    // Detach the TUI's key handler while the child owns the terminal, so its
    // stdin and our "press any key" prompt don't feed back into the frame.
    process.stdin.removeListener("data", onData);
    out.write("\x1b[?25h\x1b[?1049l"); // leave alt-screen, show cursor
    process.stdin.setRawMode(false);
    process.stdin.pause();
    let code = -1;
    try {
      const child = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      code = await child.exited;
      // Hold on the finished output until a key, so it isn't wiped instantly.
      process.stdout.write("\n[done — press any key to return to leet] ");
      process.stdin.setRawMode(true);
      process.stdin.resume();
      await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
    } catch {
      code = -1;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData); // re-attach the TUI key handler
    out.write("\x1b[?1049h\x1b[?25l"); // re-enter alt-screen, hide cursor
    return code;
  };

  // Pull-solutions: add LeetCode-solved problems missing from the sync repo.
  // Runs the real `leet pull-solutions` in a suspended shell (it clones, fetches,
  // and pushes with live progress), then refreshes local state.
  const syncPullSolutions = async (): Promise<void> => {
    if (!state.sync) return;
    const repo = resolveSyncRepo(undefined, await loadConfig());
    if (!repo) {
      syncLog("No sync repo configured — set it in Config (Sync repo) first.");
      return;
    }
    state.sync.busy = true;
    render();
    const code = await runLeetInShell(["pull-solutions", repo]);
    syncLog(code === 0 ? `pull-solutions finished (${repo}).` : `pull-solutions exited ${code}.`);
    state.sync.busy = false;
    render();
  };

  // Run a git command in `cwd`, logging the trimmed output to the sync panel.
  // Returns { code, out } so callers can branch on success and show detail.
  const gitInDir = async (args: string[], cwd: string): Promise<{ code: number; out: string }> => {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, out: (stdout + stderr).trim() };
  };

  // Commit + push the local solutions dir. It lives inside a git repo (the
  // leet-cli checkout or wherever the user keeps solutions); this stages that
  // dir, commits if there's anything new, and pushes — logging each step.
  const syncPushDir = async (): Promise<void> => {
    if (!state.sync) return;
    const config = await loadConfig();
    const dir = resolveSolutionsDir(undefined, config);
    state.sync.busy = true;
    state.sync.lines = [`Committing + pushing ${dir}…`];
    render();
    try {
      // Resolve the git repo root that contains the solutions dir.
      const root = await gitInDir(["rev-parse", "--show-toplevel"], dir);
      if (root.code !== 0) {
        syncLog(`${dir} is not inside a git repository — nothing to push.`);
        state.sync.busy = false;
        render();
        return;
      }
      const cwd = root.out;
      await gitInDir(["add", "--", dir], cwd);
      const status = await gitInDir(["status", "--porcelain", "--", dir], cwd);
      if (status.out === "") {
        syncLog("Nothing to commit — the solutions dir is already up to date.");
        state.sync.busy = false;
        render();
        return;
      }
      const commit = await gitInDir(["commit", "-m", `solutions: update ${dir} (leet-cli)`, "--", dir], cwd);
      if (commit.code !== 0) {
        syncLog(`commit failed: ${commit.out.split("\n")[0] ?? ""}`);
        state.sync.busy = false;
        render();
        return;
      }
      syncLog("committed; pushing…");
      const push = await gitInDir(["push"], cwd);
      syncLog(push.code === 0 ? "pushed." : `push failed: ${push.out.split("\n").slice(-1)[0] ?? ""}`);
    } catch (err) {
      syncLog(`push-dir failed: ${err instanceof Error ? err.message : String(err)}`);
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
    else if (action === "markRepo") void syncMarkRepo();
    // The two outward-writing git actions gate behind a y/n confirm first.
    else if (action === "pullSolutions") {
      state.sync.confirm = {
        action: "pullSolutions",
        prompt: "pull your solved LeetCode problems into the sync repo and push?",
      };
      render();
    } else if (action === "pushDir") {
      state.sync.confirm = {
        action: "pushDir",
        prompt: "commit + push your local solutions dir?",
      };
      render();
    } else if (action === "push") void syncPushPlan();
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
      case "tag":
        state.tagPicker = { index: 0 };
        break;
      case "roadmap":
        state.roadmap = {
          cursor: 0,
          chart: resolveRoadmapChart(config),
          subset: resolveRoadmapSubset(config),
        };
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
        state.preview = { slug: null, status: "idle", text: "", scroll: 0 };
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
              // The checklist shows *include*, but we store *exclude*, so a
              // toggle flips this list's membership in the excluded set.
              const name = pick.choices[pick.index];
              if (name) {
                const next = toggleSelection(cfg.working[pick.key] as string[] | undefined, name);
                if (next.length > 0) (cfg.working[pick.key] as string[]) = next;
                else delete cfg.working[pick.key];
              }
              break;
            }
            case "a": // all included — exclude nothing (the default)
              delete cfg.working[pick.key];
              break;
            case "n": // none included — exclude every list
              (cfg.working[pick.key] as string[]) = [...pick.choices];
              break;
          }
          render();
          return;
        }

        if (cfg.editing) {
          // Live repo autocomplete on the sync-repo field: the current matches
          // for the typed draft, so ↑↓/Tab operate on what's on screen.
          const suggests = fieldHasRepoSuggest(field)
            ? filterRepoSuggestions(cfg.repoSuggestions, cfg.draft)
            : [];
          if (key === "\r" || key === "\n") {
            const v = cfg.draft.trim();
            // Only text fields ever enter edit mode; multiselect opens the picker.
            if (v) (cfg.working[field.key] as string) = v;
            else delete cfg.working[field.key];
            cfg.editing = false;
          } else if (key === "\x1b") {
            cfg.editing = false; // cancel edit, keep prior value
          } else if (suggests.length > 0 && key === "\t") {
            // Tab accepts the highlighted suggestion into the draft.
            cfg.draft = suggests[Math.min(cfg.suggestIndex, suggests.length - 1)]!;
            cfg.suggestIndex = 0;
          } else if (suggests.length > 0 && (key === "\x1b[A" || key === "\x1b[B")) {
            const dir = key === "\x1b[A" ? -1 : 1;
            cfg.suggestIndex = (cfg.suggestIndex + dir + suggests.length) % suggests.length;
          } else if (key === "\x7f" || key === "\b") {
            cfg.draft = cfg.draft.slice(0, -1);
            cfg.suggestIndex = 0;
          } else if (key === "\x03") {
            finish();
            return;
          } else if (key >= " " && !key.startsWith("\x1b")) {
            cfg.draft += key;
            cfg.suggestIndex = 0;
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
            } else if (field.kind === "boolean") {
              // Toggle in place — no text edit for on/off fields.
              if (cfg.working[field.key]) delete cfg.working[field.key];
              else (cfg.working[field.key] as boolean) = true;
            } else {
              cfg.editing = true;
              cfg.draft = (cfg.working[field.key] as string | undefined) ?? "";
            }
            break;
        }
        render();
        return;
      }

      // ── tag-picker overlay ── (checklist of NeetCode patterns)
      if (state.tagPicker) {
        const tp = state.tagPicker;
        const patterns = NEETCODE_PATTERNS;
        switch (key) {
          case "\x03":
            finish();
            return;
          case "\x1b":
          case "\r":
          case "\n":
          case "q":
            state.tagPicker = null;
            recompute(state);
            break;
          case "k":
          case "\x1b[A":
            tp.index = Math.max(0, tp.index - 1);
            break;
          case "j":
          case "\x1b[B":
            tp.index = Math.min(patterns.length - 1, tp.index + 1);
            break;
          case " ": {
            const pat = patterns[tp.index]!;
            if (state.tagFilter.has(pat)) state.tagFilter.delete(pat);
            else state.tagFilter.add(pat);
            recompute(state);
            break;
          }
          case "a":
            for (const p of patterns) state.tagFilter.add(p);
            recompute(state);
            break;
          case "n":
            state.tagFilter.clear();
            recompute(state);
            break;
          default:
            return;
        }
        render();
        return;
      }

      // ── roadmap overlay ── (box flowchart; Enter studies a pattern) ──
      if (state.roadmap) {
        const rm = state.roadmap;
        const chart = rm.chart === "full" ? fullChart(topicsByPattern()) : neetcodeChart();
        const flat = chart.rows.flat();
        switch (key) {
          case "\x03":
            finish();
            return;
          case "\x1b":
          case "q":
            state.roadmap = null;
            break;
          case "k":
          case "\x1b[A":
            rm.cursor = chartMove(chart, rm.cursor, "up");
            break;
          case "j":
          case "\x1b[B":
            rm.cursor = chartMove(chart, rm.cursor, "down");
            break;
          case "h":
          case "\x1b[D":
            rm.cursor = chartMove(chart, rm.cursor, "left");
            break;
          case "l":
          case "\x1b[C":
            rm.cursor = chartMove(chart, rm.cursor, "right");
            break;
          case "c": {
            // Cycle the chart type; reset the cursor since the node list changes.
            const i = ROADMAP_CHARTS.indexOf(rm.chart);
            rm.chart = ROADMAP_CHARTS[(i + 1) % ROADMAP_CHARTS.length]!;
            rm.cursor = 0;
            break;
          }
          case "\t":
          case "\x1b[Z": {
            // Cycle the counting subset.
            const i = ROADMAP_SUBSETS.indexOf(rm.subset);
            const dir = key === "\t" ? 1 : -1;
            rm.subset = ROADMAP_SUBSETS[(i + dir + ROADMAP_SUBSETS.length) % ROADMAP_SUBSETS.length]!;
            break;
          }
          case "\r":
          case "\n": {
            // Study this node: filter the Problems panel to its pattern, close.
            const node = flat[rm.cursor];
            if (node) {
              state.tagFilter = new Set([node.pattern]);
              state.roadmap = null;
              state.focus = "problems";
              state.lastPanel = "problems";
              state.cursor = 0;
              state.top = 0;
              recompute(state);
            }
            break;
          }
          default:
            return;
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
        // Generic confirmation gate for the git actions: y runs, n/Esc cancels.
        if (sync.confirm) {
          if (key === "y" || key === "Y") {
            const action = sync.confirm.action;
            sync.confirm = null;
            if (action === "pullSolutions") void syncPullSolutions();
            else if (action === "pushDir") void syncPushDir();
          } else if (key === "n" || key === "N" || key === "\x1b") {
            sync.confirm = null;
            syncLog("cancelled.");
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

      // ── fullscreen reading mode ── (owns all input while active)
      if (state.fullscreen) {
        const maxLogScroll = Math.max(0, state.logs.lines.length - 1);
        switch (key) {
          case "\x03":
          case "q":
            finish();
            return;
          case "F":
          case "\x1b": // Esc / ← leave fullscreen, restoring the panel layout
          case "\x1b[D":
            state.fullscreen = false;
            break;
          case "\t": // Tab / Shift-Tab flip between the description and the logs
          case "\x1b[Z":
            state.focus = state.focus === "logs" ? "preview" : "logs";
            state.lastPanel = state.focus;
            break;
          case "k":
          case "\x1b[A":
            if (state.focus === "logs") state.logs.scroll = Math.max(0, state.logs.scroll - 1);
            else state.preview.scroll = Math.max(0, state.preview.scroll - 1);
            break;
          case "j":
          case "\x1b[B":
            if (state.focus === "logs") state.logs.scroll = Math.min(maxLogScroll, state.logs.scroll + 1);
            else
              state.preview.scroll = Math.min(
                Math.max(0, previewBodyLen() - 1),
                state.preview.scroll + 1,
              );
            break;
          case "\x1b[5~": // PgUp
            if (state.focus === "logs") state.logs.scroll = Math.max(0, state.logs.scroll - pageStep());
            else state.preview.scroll = Math.max(0, state.preview.scroll - pageStep());
            break;
          case "\x1b[6~": // PgDn
            if (state.focus === "logs")
              state.logs.scroll = Math.min(maxLogScroll, state.logs.scroll + pageStep());
            else
              state.preview.scroll = Math.min(
                Math.max(0, previewBodyLen() - 1),
                state.preview.scroll + pageStep(),
              );
            break;
          case "g":
            if (state.focus === "logs") state.logs.scroll = 0;
            else state.preview.scroll = 0;
            break;
          case "G":
            if (state.focus === "logs") state.logs.scroll = maxLogScroll;
            else state.preview.scroll = Math.max(0, previewBodyLen() - 1);
            break;
          case " ":
            void toggleDone();
            return;
          case "s":
            void solveCurrent();
            return;
          case "t":
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
        T: "tag",
        m: "roadmap",
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
          case "F": // jump straight into fullscreen reading mode
            state.focus = "preview";
            state.lastPanel = "preview";
            state.fullscreen = true;
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
          case "F": // fullscreen reading mode (description + logs)
            state.fullscreen = true;
            void loadPreview();
            break;
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
          case "F": // fullscreen reading mode (description + logs)
            state.fullscreen = true;
            void loadPreview();
            break;
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
