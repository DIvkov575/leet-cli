# Sync accessibility + one-key submit-and-push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Sync overlay a direct `y` hotkey, and make `u` (submit) also commit + push the just-accepted solution file to the user's personal solutions repo, with no extra confirmation step.

**Architecture:** Extract the git add/commit/push sequence already used by `syncPushDir` in `src/ui/actions.ts` into a small reusable helper parameterized by which paths to stage, so both `syncPushDir` (whole solutions dir) and the new post-Accepted push (single file) share one implementation. Add `y` to the global accelerator map in `src/ui/input.ts`. Update docs (`README.md`, in-app help) to describe both changes.

**Tech Stack:** Bun + TypeScript, `bun:test` for tests, no new dependencies.

---

## Task 1: Extract `pushPathsToRepo` helper from `syncPushDir`

**Files:**
- Modify: `src/ui/actions.ts:578-627` (the existing `gitInDir` + `syncPushDir`)
- Test: `src/ui/actions.test.ts` (new file)

Today `syncPushDir` (lines 588-627) inlines the whole add/commit/push sequence for the configured solutions dir. Pull that sequence into a standalone helper, `pushPathsToRepo`, that takes the paths to stage instead of a hardcoded `dir`, and returns a small result object instead of writing to `syncLog` directly — so it's usable from both the Sync overlay and the new post-submit push, which log to different places (`state.sync.lines` vs the Logs transcript).

- [ ] **Step 1: Write the failing test for the new helper's shape**

Create `src/ui/actions.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushPathsToRepo } from "./actions.ts";

function run(args: string[], cwd: string): { code: number; out: string } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? 1, out: (proc.stdout.toString() + proc.stderr.toString()).trim() };
}

/** A bare remote + a clone with user.email/name set, so commits succeed. */
function makeRepoPair(): { clone: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "leet-push-"));
  const bare = join(root, "bare.git");
  const clone = join(root, "clone");
  mkdirSync(bare);
  run(["init", "--bare"], bare);
  run(["clone", bare, clone], root);
  run(["config", "user.email", "test@example.com"], clone);
  run(["config", "user.name", "Test"], clone);
  return { clone, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("pushPathsToRepo", () => {
  test("not a git repo — reports not-a-repo, no throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "leet-push-norepo-"));
    try {
      const result = await pushPathsToRepo(dir, [dir], "commit msg");
      expect(result.status).toBe("not-a-repo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("nothing changed — reports no-changes", async () => {
    const { clone, cleanup } = makeRepoPair();
    try {
      writeFileSync(join(clone, "a.txt"), "hello\n");
      run(["add", "-A"], clone);
      run(["commit", "-m", "seed"], clone);
      run(["push"], clone);
      const path = join(clone, "a.txt"); // already committed, unchanged
      const result = await pushPathsToRepo(clone, [path], "no-op commit");
      expect(result.status).toBe("no-changes");
    } finally {
      cleanup();
    }
  });

  test("happy path — commits and pushes the given path", async () => {
    const { clone, cleanup } = makeRepoPair();
    try {
      writeFileSync(join(clone, "a.txt"), "hello\n");
      run(["add", "-A"], clone);
      run(["commit", "-m", "seed"], clone);
      run(["push"], clone);

      writeFileSync(join(clone, "a.txt"), "changed\n");
      const path = join(clone, "a.txt");
      const result = await pushPathsToRepo(clone, [path], "update a.txt");
      expect(result.status).toBe("pushed");
      const log = run(["log", "-1", "--pretty=%s"], clone);
      expect(log.out).toBe("update a.txt");
    } finally {
      cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/ui/actions.test.ts`
Expected: FAIL — `pushPathsToRepo is not a function` (not exported yet).

- [ ] **Step 3: Write the helper, replacing the inline logic in `syncPushDir`**

In `src/ui/actions.ts`, the current `gitInDir` + `syncPushDir` block (lines 578-627) is:

```typescript
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
```

Replace it with a module-level `gitInDir` (moved out of the closure — it has no dependency on `ctx`/`state`) plus the new `pushPathsToRepo` helper, also module-level so the test can import it directly. Add these near the top of the file, after the imports and before `logsWidthForCols`:

```typescript
/** Run a git command in `cwd`, returning { code, out }. */
async function gitInDir(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: (stdout + stderr).trim() };
}

export type PushResult =
  | { status: "not-a-repo" }
  | { status: "no-changes" }
  | { status: "commit-failed"; detail: string }
  | { status: "push-failed"; detail: string }
  | { status: "pushed" };

/**
 * git add/commit/push for the given paths. `cwd` anchors where the repo root
 * is discovered from (`git rev-parse --show-toplevel`) — it MUST be a
 * directory (`Bun.spawn`'s `cwd` throws ENOTDIR on a file path), so callers
 * pass the containing solutions dir even when staging a single file inside
 * it. Used both for the whole solutions dir (Sync → push dir, `paths =
 * [dir]`) and a single just-accepted file (submit-and-push, `paths =
 * [filePath]`). Never throws; every outcome is a `PushResult`.
 */
export async function pushPathsToRepo(
  cwdDir: string,
  paths: string[],
  commitMessage: string,
): Promise<PushResult> {
  try {
    const root = await gitInDir(["rev-parse", "--show-toplevel"], cwdDir);
    if (root.code !== 0) return { status: "not-a-repo" };
    const cwd = root.out;
    await gitInDir(["add", "--", ...paths], cwd);
    const status = await gitInDir(["status", "--porcelain", "--", ...paths], cwd);
    if (status.out === "") return { status: "no-changes" };
    const commit = await gitInDir(["commit", "-m", commitMessage, "--", ...paths], cwd);
    if (commit.code !== 0) return { status: "commit-failed", detail: commit.out.split("\n")[0] ?? "" };
    const push = await gitInDir(["push"], cwd);
    if (push.code !== 0) return { status: "push-failed", detail: push.out.split("\n").slice(-1)[0] ?? "" };
    return { status: "pushed" };
  } catch (err) {
    return { status: "push-failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
```

Then rewrite `syncPushDir` (still inside `createActions`, since it touches `state.sync`) to call the helper:

```typescript
  const syncPushDir = async (): Promise<void> => {
    if (!state.sync) return;
    const config = await loadConfig();
    const dir = resolveSolutionsDir(undefined, config);
    state.sync.busy = true;
    state.sync.lines = [`Committing + pushing ${dir}…`];
    render();
    const result = await pushPathsToRepo(dir, [dir], `solutions: update ${dir} (leet-cli)`);
    switch (result.status) {
      case "not-a-repo":
        syncLog(`${dir} is not inside a git repository — nothing to push.`);
        break;
      case "no-changes":
        syncLog("Nothing to commit — the solutions dir is already up to date.");
        break;
      case "commit-failed":
        syncLog(`commit failed: ${result.detail}`);
        break;
      case "push-failed":
        syncLog(`push failed: ${result.detail}`);
        break;
      case "pushed":
        syncLog("committed; pushed.");
        break;
    }
    state.sync.busy = false;
    render();
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/ui/actions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full test suite to check nothing else broke**

Run: `bun test`
Expected: all existing tests still PASS (this step only moved/refactored `gitInDir` and `syncPushDir`'s internals; `syncPushDir`'s externally-visible log strings for `not-a-repo`/`no-changes`/failures are unchanged — only the final success message changed from `"committed; pushing…"` + a separate `"pushed."` line to a single `"committed; pushed."` line, since the helper doesn't have a hook for an intermediate log). If any test asserted the old two-line success sequence, update it to expect `"committed; pushed."`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/actions.ts src/ui/actions.test.ts
git commit -m "refactor: extract pushPathsToRepo helper from syncPushDir"
```

---

## Task 2: `y` opens the Sync overlay from any panel

**Files:**
- Modify: `src/ui/input.ts:673-685` (the `accel` record)
- Modify: `src/ui/menu.ts:59-67` (`PALETTE_ITEMS`)
- Modify: `src/ui/input.test.ts` (add a test)

- [ ] **Step 1: Write the failing test**

In `src/ui/input.test.ts`, add to the `describe("input handler — overlays", ...)` block (after the existing `"u submits to LeetCode..."` test, before its closing `});` at line 214):

```typescript
  test("y opens the Sync overlay directly, from any panel", () => {
    const h = harness();
    expect(h.state.sync).toBeNull();
    h.key("y");
    expect(h.state.sync).not.toBeNull();
    expect(h.state.sync?.index).toBe(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/ui/input.test.ts`
Expected: FAIL — `h.state.sync` is still `null` after pressing `y` (no accelerator wired yet).

- [ ] **Step 3: Wire `y` into the accelerator map**

In `src/ui/input.ts`, the `accel` record (lines 673-685) currently reads:

```typescript
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
```

Add a `y: "sync"` entry:

```typescript
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
      y: "sync",
      c: "config",
      "?": "help",
    };
```

`activateMenu`'s `"sync"` case (already present, `src/ui/input.ts:95-97`) already calls `actions.openSync()`, so no change is needed there.

- [ ] **Step 4: Update the palette's displayed hotkey**

In `src/ui/menu.ts`, `PALETTE_ITEMS` (lines 59-67) currently has:

```typescript
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  { label: "Lists", action: "list", key: "L" },
  { label: "Open in browser", action: "open", key: "o" },
  { label: "Sync (auth · pull · push)", action: "sync", key: "—" },
  { label: "Import solved", action: "import", key: "i" },
  { label: "Refresh from LeetCode", action: "refresh", key: "R" },
  { label: "Settings", action: "config", key: "c" },
  { label: "Help", action: "help", key: "?" },
];
```

Change the Sync row's key from `"—"` to `"y"`:

```typescript
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  { label: "Lists", action: "list", key: "L" },
  { label: "Open in browser", action: "open", key: "o" },
  { label: "Sync (auth · pull · push)", action: "sync", key: "y" },
  { label: "Import solved", action: "import", key: "i" },
  { label: "Refresh from LeetCode", action: "refresh", key: "R" },
  { label: "Settings", action: "config", key: "c" },
  { label: "Help", action: "help", key: "?" },
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/ui/input.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/input.ts src/ui/menu.ts src/ui/input.test.ts
git commit -m "feat: add y hotkey to open the Sync overlay directly"
```

---

## Task 3: `u` pushes the accepted solution file to the personal repo

**Files:**
- Modify: `src/ui/actions.ts:321-398` (`submitCurrent`)
- Modify: `src/ui/input.test.ts` (extend the existing submit test coverage)

- [ ] **Step 1: Write the failing test**

The existing "u submits..." test in `src/ui/input.test.ts` only covers the no-auth path (no network, deterministic). Add a new test right after it (still inside `describe("input handler — overlays", ...)`) that exercises the Accepted + push path using a real temp git repo, mocking `fetch` for the LeetCode calls and pointing `solutionsDir` at the temp repo:

```typescript
  test("u, once Accepted, commits + pushes the solution file to the repo it lives in", async () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const run = (args: string[], cwd: string) => {
      const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
      return (proc.stdout.toString() + proc.stderr.toString()).trim();
    };

    const root = mkdtempSync(join(tmpdir(), "leet-submit-push-"));
    const bare = join(root, "bare.git");
    const solutionsDir = join(root, "solutions");
    mkdirSync(bare);
    run(["init", "--bare"], bare);
    run(["clone", bare, solutionsDir], root);
    run(["config", "user.email", "test@example.com"], solutionsDir);
    run(["config", "user.name", "Test"], solutionsDir);
    // Seed an initial commit so the clone has a remote-tracking branch to push against.
    writeFileSync(join(solutionsDir, ".gitkeep"), "");
    run(["add", "-A"], solutionsDir);
    run(["commit", "-m", "seed"], solutionsDir);
    run(["push"], solutionsDir);

    // problem-1 in the harness has id 1, slug "problem-1" — write its solution file.
    writeFileSync(join(solutionsDir, "1-problem-1.cpp"), "class Solution {};\n");

    const prevDataDir = process.env.LEET_DATA_DIR;
    const prevSession = process.env.LEETCODE_SESSION;
    const prevCsrf = process.env.LEETCODE_CSRF;
    process.env.LEET_DATA_DIR = mkdtempSync(join(tmpdir(), "leet-data-"));
    process.env.LEETCODE_SESSION = "s";
    process.env.LEETCODE_CSRF = "c";

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/graphql")) {
        return new Response(JSON.stringify({ data: { question: { questionId: "1" } } }), { status: 200 });
      }
      if (url.endsWith("/submit/")) {
        return new Response(JSON.stringify({ submission_id: 1 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ state: "SUCCESS", status_msg: "Accepted", total_correct: 1, total_testcases: 1 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const h = harness();
      // Point the harness's resolved solutionsDir at our temp repo via config.json.
      writeFileSync(
        join(process.env.LEET_DATA_DIR, "config.json"),
        JSON.stringify({ solutionsDir, leetcodeSession: "s", leetcodeCsrf: "c" }),
      );
      h.key("u");
      // Flush the async submit + push chain.
      await new Promise((r) => setTimeout(r, 50));
      expect(h.state.logs.ok).toBe(true);
      expect(h.state.logs.lines.join(" ")).toMatch(/pushed/i);
      const log = run(["log", "-1", "--pretty=%s"], solutionsDir);
      expect(log).toContain("1-problem-1");
    } finally {
      globalThis.fetch = realFetch;
      if (prevDataDir === undefined) delete process.env.LEET_DATA_DIR;
      else process.env.LEET_DATA_DIR = prevDataDir;
      if (prevSession === undefined) delete process.env.LEETCODE_SESSION;
      else process.env.LEETCODE_SESSION = prevSession;
      if (prevCsrf === undefined) delete process.env.LEETCODE_CSRF;
      else process.env.LEETCODE_CSRF = prevCsrf;
      rmSync(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/ui/input.test.ts`
Expected: FAIL — `h.state.logs.lines.join(" ")` does not match `/pushed/i` (submit succeeds and marks Accepted, but nothing pushes yet).

- [ ] **Step 3: Add the push step to `submitCurrent`**

In `src/ui/actions.ts`, `submitCurrent` (lines 321-398) currently ends its success branch with:

```typescript
      // Accepted → mark done locally so the UI reflects it immediately.
      if (v.accepted && !state.completed.has(p.id)) {
        state.completed.add(p.id);
        await saveCompleted(state.completed);
        recompute(state);
      }
      log(lines, v.accepted ? "Accepted" : v.statusMsg, v.accepted);
    } catch (err) {
```

Insert the push step between marking completion and the final `log(...)` call, so the push's outcome lines are appended to the same `lines` array that becomes the Logs block:

```typescript
      // Accepted → mark done locally so the UI reflects it immediately.
      if (v.accepted && !state.completed.has(p.id)) {
        state.completed.add(p.id);
        await saveCompleted(state.completed);
        recompute(state);
      }
      // Accepted → also push this one file to whatever git repo the solutions
      // dir lives in (no confirmation; mirrors Sync → "Commit + push solutions
      // dir" but scoped to just this problem).
      if (v.accepted) {
        const filePath = `${dir}/${scaffoldFilename(p.id, p.slug)}`;
        const push = await pushPathsToRepo(dir, [filePath], `solutions: ${p.id}-${p.slug} (leet-cli)`);
        lines.push("");
        switch (push.status) {
          case "not-a-repo":
            lines.push(`(${dir} is not inside a git repository — skipped repo push.)`);
            break;
          case "no-changes":
            lines.push(`(${filePath} already up to date in the repo — nothing to push.)`);
            break;
          case "commit-failed":
            lines.push(`(repo commit failed: ${push.detail})`);
            break;
          case "push-failed":
            lines.push(`(repo push failed: ${push.detail})`);
            break;
          case "pushed":
            lines.push(`(pushed ${filePath} to the repo.)`);
            break;
        }
      }
      log(lines, v.accepted ? "Accepted" : v.statusMsg, v.accepted);
    } catch (err) {
```

`pushPathsToRepo` is defined at module level in this same file (per Task 1), so no new import is needed. `dir` is already in scope from earlier in `submitCurrent` (`const dir = resolveSolutionsDir(undefined, config);`, line 342) and is passed as the `cwdDir` anchor — it's a directory, so it's safe to use as `Bun.spawn`'s `cwd` (unlike `filePath`, which is a file and would throw `ENOTDIR` if used as `cwd` directly).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/ui/input.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/actions.ts src/ui/input.test.ts
git commit -m "feat: u pushes the accepted solution file to the personal repo"
```

---

## Task 4: Update docs

**Files:**
- Modify: `README.md` (keybinding table, Interactive mode section, Sync section)
- Modify: `src/ui/render.ts:36-77` (`HELP_LINES`)
- Modify: `src/ui/render.ts:103-113` (`footerLine` hints)

- [ ] **Step 1: Update `HELP_LINES` in `src/ui/render.ts`**

Current relevant lines (36-77):

```typescript
const HELP_LINES = [
  "  leet — key bindings",
  "",
  "  Four hierarchical panels: Lists → Problems → Preview → Logs.",
  "  → / Enter drills deeper (open a list, preview a problem, then its",
  "  test logs); ← / Esc steps back out. The menu bar (top) has just four",
  "  entries — Search · Filter · Roadmap · Menu — Tab enters it, ←→ move,",
  "  Enter fires; Esc returns to your panel. Menu lists everything else.",
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
  "    u             submit — upload the solution to LeetCode; verdict in Logs",
  "    P             prefetch the current view into the cache (offline)",
  "    Tab           enter the menu bar",
  "    q             quit",
  "",
  "  Direct shortcuts (from any panel)",
  "    /  search          f  filter overlay (status·difficulty·sort·tags)",
  "    m  roadmap         d  difficulty   S  sort   T  tags",
  "    L  lists           o  open in browser         R  refresh",
  "    i  import          c  settings                ?  help",
  "",
  "  Menu (bar → Menu) is a command palette of everything above with keys —",
  "  handy when you don't remember a shortcut.",
  "",
  "  Tags & roadmap",
  "    T             filter the list by NeetCode pattern (checklist)",
  "    m             open the roadmap — a box flowchart of the patterns;",
  "                  ↑↓←→ move · Enter filters to a pattern · Tab subset",
  "",
  "  Sync (Menu → Sync): authenticate, pull solved from LeetCode,",
  "  and push solutions to your account (with a confirm before submitting).",
];
```

Replace with:

```typescript
const HELP_LINES = [
  "  leet — key bindings",
  "",
  "  Four hierarchical panels: Lists → Problems → Preview → Logs.",
  "  → / Enter drills deeper (open a list, preview a problem, then its",
  "  test logs); ← / Esc steps back out. The menu bar (top) has just four",
  "  entries — Search · Filter · Roadmap · Menu — Tab enters it, ←→ move,",
  "  Enter fires; Esc returns to your panel. Menu lists everything else.",
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
  "    u             submit to LeetCode; on Accepted also pushes the file to",
  "                  your solutions repo (if it's a git repo). Verdict in Logs",
  "    P             prefetch the current view into the cache (offline)",
  "    Tab           enter the menu bar",
  "    q             quit",
  "",
  "  Direct shortcuts (from any panel)",
  "    /  search          f  filter overlay (status·difficulty·sort·tags)",
  "    m  roadmap         d  difficulty   S  sort   T  tags",
  "    L  lists           o  open in browser         R  refresh",
  "    i  import          c  settings                ?  help",
  "    y  sync (auth · pull · push)",
  "",
  "  Menu (bar → Menu) is a command palette of everything above with keys —",
  "  handy when you don't remember a shortcut.",
  "",
  "  Tags & roadmap",
  "    T             filter the list by NeetCode pattern (checklist)",
  "    m             open the roadmap — a box flowchart of the patterns;",
  "                  ↑↓←→ move · Enter filters to a pattern · Tab subset",
  "",
  "  Sync (y, or Menu → Sync): authenticate, pull solved from LeetCode,",
  "  and push solutions to your account (with a confirm before submitting).",
];
```

- [ ] **Step 2: Update `footerLine` hints in `src/ui/render.ts`**

Current lines 103-112:

```typescript
  const hint =
    s.focus === "lists"
      ? " ↑↓ move · Enter/→ open list · Tab menu · q quit · ? help"
      : s.focus === "problems"
        ? " ↑↓ move · Enter preview · s solve · t test · u submit · Space done · ← lists"
        : s.focus === "preview"
          ? " ↑↓ scroll · F full · s solve · t test · u submit · →/Enter logs · o open · ← back"
          : s.focus === "logs"
            ? " ↑↓ scroll · t re-run · u submit · s solve · Space done · ← preview · Tab menu"
            : " ←→ move · Enter fire · Esc back to panel";
  return paint(fit(hint, cols), "dim");
```

These hints are already at the width budget for a narrow terminal, so leave the per-panel hints as-is (they already say "submit", which still covers `u`'s expanded behavior at a glance) — no change needed here. Skip this step; it's a non-change confirmed during review, not a placeholder.

- [ ] **Step 3: Update `README.md`**

In the keybinding table (around line 375):

Find:
```
| `u`              | submit — upload the solution to LeetCode, verdict in Logs |
```

Replace with:
```
| `u`              | submit to LeetCode; on Accepted, also pushes the file to your solutions repo |
```

In the "Submit straight from the TUI" paragraph (README.md lines 345-350):

Find:
```
**Submit straight from the TUI** — press **`u`** on any problem to upload your
solution to LeetCode without opening a browser. It reads the file you've been
editing (`solve`/`test` scaffold), strips the local test harness, submits, and
prints the judge verdict — Accepted / Wrong Answer, cases passed, and any
compile/runtime detail — into the **Logs** panel. An Accepted verdict marks the
problem done locally. (Needs `leet auth` first, for the session + CSRF token.)
```

Replace with:
```
**Submit straight from the TUI** — press **`u`** on any problem to upload your
solution to LeetCode without opening a browser. It reads the file you've been
editing (`solve`/`test` scaffold), strips the local test harness, submits, and
prints the judge verdict — Accepted / Wrong Answer, cases passed, and any
compile/runtime detail — into the **Logs** panel. An Accepted verdict marks the
problem done locally, and also commits + pushes that one solution file to
whatever git repo your solutions directory lives in (if any — no separate
confirmation, and it's skipped quietly if the directory isn't in a git repo).
(Needs `leet auth` first, for the session + CSRF token.)
```

In the "menu bar" paragraph (README.md lines 352-359):

Find:
```
Every action also lives in a **menu bar** across the top, trimmed to four
entries — press **Tab** to enter it, `←→` to move, `Enter` to fire: **Search ·
Filter · Roadmap · Menu**. *Filter* opens a combined overlay (status ·
difficulty · sort · tags); *Menu* is a command palette listing everything else
(Lists · Open · Sync · Import · Refresh · Settings · Help) with its hotkey.
The **Sync** action (via Menu) runs the LeetCode account features right in the
TUI — authenticate from your browser, pull your solved problems, and push
solutions in bulk (with an in-panel confirm before any real submission).
```

Replace with:
```
Every action also lives in a **menu bar** across the top, trimmed to four
entries — press **Tab** to enter it, `←→` to move, `Enter` to fire: **Search ·
Filter · Roadmap · Menu**. *Filter* opens a combined overlay (status ·
difficulty · sort · tags); *Menu* is a command palette listing everything else
(Lists · Open · Sync · Import · Refresh · Settings · Help) with its hotkey.
The **Sync** action — press **`y`** from any panel, or reach it via Menu — runs
the LeetCode account features right in the TUI: authenticate from your
browser, pull your solved problems, and push solutions in bulk (with an
in-panel confirm before any real submission).
```

In the core keys table (README.md lines 364-378), find the row:
```
| `u`              | submit — upload the solution to LeetCode, verdict in Logs |
```
(this is a duplicate of the earlier table edit — there are two tables in the file; verify both were caught by searching for all occurrences of `submit — upload` in `README.md` and updating each to the same replacement text used in Step 3's first edit).

Find the "Every action has a direct shortcut" paragraph (README.md lines 380-384):
```
Every action has a direct shortcut, usable from any panel: `/` search, `f`
filter overlay, `m` roadmap, `d` difficulty, `S` sort, `T` tags, `r` random,
`L` lists, `o` open, `R` refresh, `i` import, `c` settings, `?` help. `s`/`t`/`u`
are solve / test / submit on the Problems/Preview/Logs panels. Press `?` in-app
for the full reference, or **Menu** in the bar for a clickable palette.
```

Replace with:
```
Every action has a direct shortcut, usable from any panel: `/` search, `f`
filter overlay, `m` roadmap, `d` difficulty, `S` sort, `T` tags, `r` random,
`L` lists, `o` open, `R` refresh, `i` import, `y` sync, `c` settings, `?` help.
`s`/`t`/`u` are solve / test / submit on the Problems/Preview/Logs panels.
Press `?` in-app for the full reference, or **Menu** in the bar for a
clickable palette.
```

- [ ] **Step 4: Verify the doc edits render sensibly**

Run: `grep -n "submit — upload\|press \*\*\`u\`\*\*\|press \*\*Tab\*\* to enter" README.md`
Expected: no remaining matches for the old `"submit — upload the solution to LeetCode, verdict in Logs"` phrasing (confirms both table occurrences were updated).

- [ ] **Step 5: Commit**

```bash
git add README.md src/ui/render.ts
git commit -m "docs: document the y sync hotkey and u's repo-push behavior"
```

---

## Task 5: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: all tests PASS, no failures or skips beyond the pre-existing `compileAndRun` skip-if-no-compiler guard.

- [ ] **Step 2: Type-check**

Run: `bun x tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Recompile and relink the binary**

Per project convention, rerun the compiled binary + global link after any code change:

```bash
bun run compile
bun link
```

Expected: both commands succeed; `leet` (compiled binary in the repo root) and the global `leet` command now reflect this worktree's `src/cli.ts`.

- [ ] **Step 4: Manual smoke test**

Run `leet` (or `bun run src/cli.ts`) in a terminal, navigate to any problem, and verify:
- Pressing `y` from the Problems panel opens the Sync overlay.
- Pressing `Esc` closes it and returns focus to Problems.
- (If you have `leet auth` set up and a git-backed solutions dir) pressing `u` on a problem you can get Accepted shows the push outcome appended under the verdict in Logs.
