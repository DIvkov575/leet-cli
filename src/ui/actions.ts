/**
 * The TUI's side-effecting actions: everything that loads/saves data, shells
 * out, or drives the sync overlay. `createActions(ctx)` closes over the shared
 * context and returns the bag of actions the input handler dispatches to. Split
 * out of the old `runTui` mega-closure so the runtime is legible.
 */
import type { Problem } from "../types.ts";
import { loadList, saveList, ALL_LIST_NAME } from "../lib.ts";
import { fetchProblem, fetchProblems } from "../leetcode.ts";
import { resolveDescription } from "../description.ts";
import { listUserRepos } from "../repo.ts";
import { importSource } from "../import.ts";
import { saveCompleted } from "../progress.ts";
import {
  loadConfig,
  saveConfig,
  resolveEditor,
  resolveSolutionsDir,
  resolveCxx,
  resolveLeetCodeAuth,
  resolveSyncRepo,
} from "../config.ts";
import { setConfigOffline } from "../net.ts";
import { prefetchProblems } from "../prefetch.ts";
import { setupHasRun, markSetupDone } from "../setup.ts";
import { scaffoldContent, scaffoldFilename, solutionCodeForSubmit } from "../scaffold.ts";
import { buildSolutionFile, hasStatementBlock, withStatement } from "../solution-file.ts";
import { compileAndRun } from "../runner.ts";
import { authFromBrowser } from "../auth.ts";
import { fetchSolvedSlugs } from "../leetcode-progress.ts";
import { submitSolution } from "../leetcode-submit.ts";
import { fetchNeetcodeCpp } from "../neetcode.ts";
import { mkdir } from "node:fs/promises";
import { wrapText } from "./layout.ts";
import { SUGGESTED_SETUP_LIST } from "./render.ts";
import { recompute, current, selectListRow, RECOMMENDED_LIST, type SyncAction } from "./state.ts";
import type { TuiContext } from "./context.ts";

export interface Actions {
  loadPreview: () => Promise<void>;
  toggleDone: () => Promise<void>;
  startPrefetch: () => void;
  acceptSetup: () => Promise<void>;
  dismissSetup: () => Promise<void>;
  refreshList: () => Promise<void>;
  openConfig: () => Promise<void>;
  closeConfig: () => Promise<void>;
  runTest: () => Promise<void>;
  submitCurrent: () => Promise<void>;
  solveCurrent: () => Promise<void>;
  runImport: (source: string) => Promise<void>;
  openSync: () => void;
  runSyncAction: (action: SyncAction) => void;
  syncPushRun: () => Promise<void>;
  syncPullSolutions: () => Promise<void>;
  syncPushDir: () => Promise<void>;
}

/** Rough width the Logs panel gets; used to pre-wrap captured output. */
function logsWidthForCols(cols: number): number {
  return Math.max(20, cols >= 110 ? Math.floor(cols * 0.3) : cols);
}

export function createActions(ctx: TuiContext): Actions {
  const { state } = ctx;
  const render = () => ctx.render();

  // Resolve the statement cache-first (local cache → synced repo .md → live
  // LeetCode); the raw text is stored and wrapped at render time.
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

  // Background prefetch of the current view into the local cache. Non-blocking.
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

  // First-run opt-in: pre-cache the suggested study set, marking setup done.
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
    // Fetch the user's repos in the background for the sync-repo autocomplete.
    void listUserRepos().then((repos) => {
      if (state.config) state.config.repoSuggestions = repos;
      render();
    });
  };

  const closeConfig = async (): Promise<void> => {
    if (!state.config) return;
    const working = state.config.working;
    state.config = null;
    await saveConfig(working);
    // Re-prime the network gate in case offline mode was toggled in-session.
    setConfigOffline(working.offline);
    // Re-rank ★ Recommended so a ranking change lands immediately.
    state.recommended = ctx.rankRecommended(working, state.completed);
    if (state.showingRecommended) await selectListRow(state, RECOMMENDED_LIST);
    state.status = "settings saved.";
    render();
  };

  // Scaffold the current problem's C++ file to disk (cache-first). Shared by
  // solve and test-run. Returns the path, or null on failure (status is set).
  const scaffoldToDisk = async (p: Problem, dir: string): Promise<string | null> => {
    const path = `${dir}/${scaffoldFilename(p.id, p.slug)}`;
    try {
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

    const w = Math.max(10, logsWidthForCols(ctx.out.columns ?? 80));
    const result = await compileAndRun(path, resolveCxx(config));
    const wrapped = result.log.split("\n").flatMap((l) => (l ? wrapText(l, w) : [""]));
    const summary = !result.compiled
      ? "compile error"
      : result.ok
        ? "PASS"
        : `FAIL (exit ${result.exitCode})`;
    if (state.logs.slug === p.slug) {
      state.logs = { slug: p.slug, status: "done", lines: wrapped, scroll: 0, summary, ok: result.ok };
      render();
    }
  };

  // Submit the current problem's solution straight to LeetCode (no browser),
  // then report the judge verdict into the Logs panel. Reuses the same on-disk
  // solution file `solve`/`test` use; strips the local harness before sending.
  const submitCurrent = async (): Promise<void> => {
    const p = current(state);
    if (!p) return;
    const config = await loadConfig();
    const auth = resolveLeetCodeAuth(config);
    // Reveal the Logs panel so progress + the verdict are visible.
    state.logs = { slug: p.slug, status: "running", lines: ["Submitting to LeetCode…"], scroll: 0 };
    state.focus = "logs";
    state.lastPanel = "logs";
    render();

    if (!auth || !auth.csrf) {
      const why = auth
        ? "No CSRF token — re-run Authenticate (Menu → Sync → Authenticate)."
        : "No LeetCode session — authenticate first (Menu → Sync → Authenticate).";
      state.logs = { slug: p.slug, status: "done", lines: [why], scroll: 0, summary: "not authenticated", ok: false };
      render();
      return;
    }

    const dir = resolveSolutionsDir(undefined, config);
    const path = `${dir}/${scaffoldFilename(p.id, p.slug)}`;
    let code: string;
    if (await Bun.file(path).exists()) {
      code = solutionCodeForSubmit(await Bun.file(path).text());
    } else {
      // Nothing edited yet — fall back to the packaged/cached scaffold so the
      // action still does something sensible (submits the starter stub).
      const scaffolded = await scaffoldToDisk(p, dir);
      if (scaffolded === null) return; // status already set by scaffoldToDisk
      code = solutionCodeForSubmit(await Bun.file(scaffolded).text());
    }

    const w = Math.max(10, logsWidthForCols(ctx.out.columns ?? 80));
    const log = (lines: string[], summary: string, ok: boolean): void => {
      if (state.logs.slug !== p.slug) return;
      const wrapped = lines.flatMap((l) => (l ? wrapText(l, w) : [""]));
      state.logs = { slug: p.slug, status: "done", lines: wrapped, scroll: 0, summary, ok };
      render();
    };

    try {
      const v = await submitSolution(auth, p.slug, code, {
        lang: "cpp",
        onRetry: (attempt, waitMs) => {
          if (state.logs.slug !== p.slug) return;
          state.logs.lines = [`Rate-limited by LeetCode — retry ${attempt} in ${Math.round(waitMs / 1000)}s…`];
          render();
        },
      });
      const lines = [
        `${v.accepted ? "✓ Accepted" : "✗ " + v.statusMsg}  (submission ${v.submissionId})`,
      ];
      if (v.passed !== undefined && v.total !== undefined) {
        lines.push(`Test cases: ${v.passed}/${v.total} passed.`);
      }
      if (v.detail) {
        lines.push("");
        lines.push(...v.detail.split("\n"));
      }
      lines.push("");
      lines.push(`View: https://leetcode.com/problems/${p.slug}/`);
      // Accepted → mark done locally so the UI reflects it immediately.
      if (v.accepted && !state.completed.has(p.id)) {
        state.completed.add(p.id);
        await saveCompleted(state.completed);
        recompute(state);
      }
      log(lines, v.accepted ? "Accepted" : v.statusMsg, v.accepted);
    } catch (err) {
      log(
        [`Submit failed: ${err instanceof Error ? err.message : String(err)}`],
        "submit error",
        false,
      );
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
    ctx.out.write("\x1b[?25h\x1b[?1049l");
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
    ctx.out.write("\x1b[?1049h\x1b[?25l");
    state.status = `edited ${path}`;
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
        `${result.matched.length} of ${result.totalSolved} solved are in bundled lists; marked ${added} new.`,
      );
    } catch (err) {
      syncLog(`pull failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    state.sync.busy = false;
    render();
  };

  // Mark problems done from the folders present in the configured sync repo.
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
        `${result.matched.length} of ${result.totalSolved} folders matched bundled problems; marked ${added} new.`,
      );
    } catch (err) {
      syncLog(`mark-solved failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    state.sync.busy = false;
    render();
  };

  // Re-invoke `leet <args>` as a child with the terminal handed over.
  const runLeetInShell = async (args: string[]): Promise<number> => {
    const self = process.argv[1];
    const cmd =
      self && self.endsWith(".ts")
        ? [process.execPath, self, ...args]
        : [process.execPath, ...args];
    if (ctx.onData) process.stdin.removeListener("data", ctx.onData);
    ctx.out.write("\x1b[?25h\x1b[?1049l");
    process.stdin.setRawMode(false);
    process.stdin.pause();
    let code = -1;
    try {
      const child = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      code = await child.exited;
      process.stdout.write("\n[done — press any key to return to leet] ");
      process.stdin.setRawMode(true);
      process.stdin.resume();
      await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
    } catch {
      code = -1;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    if (ctx.onData) process.stdin.on("data", ctx.onData);
    ctx.out.write("\x1b[?1049h\x1b[?25l");
    return code;
  };

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

  // Run a git command in `cwd`, returning { code, out }.
  const gitInDir = async (args: string[], cwd: string): Promise<{ code: number; out: string }> => {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, out: (stdout + stderr).trim() };
  };

  const syncPushDir = async (): Promise<void> => {
    if (!state.sync) return;
    const config = await loadConfig();
    const dir = resolveSolutionsDir(undefined, config);
    state.sync.busy = true;
    state.sync.lines = [`Committing + pushing ${dir}…`];
    render();
    try {
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

  // Push step 1: resolve the work list, then ask for confirmation.
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

  return {
    loadPreview,
    toggleDone,
    startPrefetch,
    acceptSetup,
    dismissSetup,
    refreshList,
    openConfig,
    closeConfig,
    runTest,
    submitCurrent,
    solveCurrent,
    runImport,
    openSync,
    runSyncAction,
    syncPushRun,
    syncPullSolutions,
    syncPushDir,
  };
}
