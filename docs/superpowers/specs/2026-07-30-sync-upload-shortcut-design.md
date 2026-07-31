# Sync accessibility + one-key submit-and-push design

## Problem

The Sync overlay (auth / pull solved / mark solved from repo / pull solutions
→ repo / push dir / push solutions) is only reachable via `Tab → Menu →
arrow to Sync → Enter` — no direct hotkey, unlike every other menu action.

Separately, submitting a solution (`u`) and getting it into your personal
solutions repo (`Sync → Commit + push solutions dir`) are two disconnected
steps: submit, then remember to go push. There's no single action that says
"I solved it, LeetCode agrees, now put it in my repo."

## Changes

### 1. `y` opens the Sync overlay directly

Add `y: "sync"` to the global accelerator map in `src/ui/input.ts` (the
`accel` record used by every panel), so `y` works from any panel exactly like
`f`/`d`/`T`/`m`/etc. do today. Update the palette entry's displayed hotkey in
`src/ui/menu.ts` (`PALETTE_ITEMS`) from `"—"` to `"y"`.

No other Sync overlay behavior changes — same six actions, same navigation
(`↑↓` to select, `Enter` to run), same confirm gates for the destructive
actions. `y`/`Y` remain used for confirm/deny *inside* the Sync overlay's own
confirm prompts (`confirmPush`, `confirm`) — unaffected, since the global
accelerator map isn't consulted while an overlay owns input.

### 2. `u` (submit) also pushes the single solution file to your personal repo on Accepted

Today `submitCurrent` (`src/ui/actions.ts`) submits the on-disk solution file
to LeetCode, and on Accepted marks the problem done locally. This adds one
more step, automatic, no confirmation prompt:

On Accepted:
1. Resolve the solutions dir (`resolveSolutionsDir`) and the specific file
   path (`<dir>/<id>-<slug>.cpp>`, same path `submitCurrent` already read the
   code from).
2. Find the git repo the solutions dir lives in, the same way `syncPushDir`
   already does (`git rev-parse --show-toplevel` run with `cwd` = the
   solutions dir). If it's not inside a git repo, log a line
   (`"<dir> is not inside a git repository — skipping repo push."`) and stop;
   this is not an error, matching `syncPushDir`'s existing behavior.
3. `git add -- <path>`; check `git status --porcelain -- <path>`. If empty
   (nothing changed — e.g. re-submitting an already-pushed file), log
   `"nothing to push — <path> already up to date."` and stop.
4. `git commit -m "solutions: <id>-<slug> (leet-cli)" -- <path>`, then
   `git push`. Log each step's outcome as its own line, appended to the same
   Logs transcript block the submit verdict was written to (so the push
   result reads directly under the Accepted verdict).

No y/n confirmation — this is auto-push by design (single-action request).
Any failure (not a git repo, commit/push failure) is logged and non-fatal:
it never affects the Accepted verdict or the local-done marking, which have
already happened by the time the push is attempted.

This does **not** require `syncRepo` to be configured — like the existing
`pushDir` action, it pushes to whatever remote the solutions dir's git repo
already has configured. If there is no remote, `git push` fails and that
failure is logged like any other.

**Implementation note:** extract the add/commit/push sequence
`syncPushDir` already implements into a small shared helper parameterized by
the paths to stage (`syncPushDir` passes `[dir]`; the new post-submit push
passes `[path]`), so the two call sites share one implementation rather than
duplicating the git-shelling logic.

### 3. Docs

Update `README.md` (keybinding table, Interactive mode section, Sync menu
description) and the in-app help (`HELP_LINES` in `src/ui/render.ts`,
`footerLine` hints) to mention:
- `y` as the direct Sync shortcut.
- `u`'s expanded behavior: submits to LeetCode, and on Accepted also
  commits + pushes that one file to your solutions repo (if it's in a git
  repo with a remote).

## Out of scope

- No changes to `syncPull` / `syncMarkRepo` logic — "pull recently solved +
  mark solved" is already served by the existing Sync overlay actions; this
  work only makes that overlay one keypress away.
- No new confirmation UI framework for the Problems/Preview/Logs panels —
  the post-Accepted push is unconditional, so no new confirm-gate state is
  needed outside the Sync overlay's existing one.
- `syncRepo` config is not consulted by the new push step (see above).

## Testing

- Unit test the extracted git add/commit/push helper (mocked `gitInDir`)
  for: no-git-repo, nothing-to-commit, commit failure, push failure, and
  the happy path — covering both callers (`pushDir`'s multi-path use and the
  new single-file use).
- Unit test that `submitCurrent` invokes the push helper only when
  `v.accepted` is true, and that its log lines land in the same Logs
  transcript block as the verdict.
- Update `src/ui/menu.ts`/`src/ui/input.ts` tests (if any target the accel
  map or palette key labels) to cover `y → sync`.
