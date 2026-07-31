# Sync `u` to the NeetCode-layout repo too — design

## Problem

`u` (submit) currently, on an Accepted verdict: submits to LeetCode, marks
the problem done locally, and pushes the solution file to whatever git repo
the flat `solutionsDir` lives in ("gh"). It does not touch the separately
configured NeetCode-layout repo (`syncRepo` in config, e.g. "neet") at all —
getting a solution into that repo today requires the standalone
`pull-solutions` flow, which only picks up problems already Accepted on your
LeetCode account, run on demand.

The user wants one action, `u`, to leave an Accepted solution synced in all
three places: LeetCode itself, the flat `gh` solutions repo (already done),
and the NeetCode-layout `syncRepo` repo ("neet").

"Pull in recently solved problems" is already served by the existing Sync
overlay's "Pull solved from LeetCode" action (reachable via `y` → `Enter`,
per the just-shipped hotkey) — no new work needed there.

## Change

### Persistent local clone of `syncRepo`

Add `src/sync-clone.ts`: manages one persistent local clone of the
configured `syncRepo`, cached under the shared data directory (see dedup
below) at `<dataDir>/sync-clone/`.

```typescript
export interface SyncCloneResult {
  path: string; // absolute path to the ready-to-use clone
}

/**
 * Ensure a local clone of `repo` (owner/repo) exists and is up to date at
 * `<dataDir>/sync-clone/`, cloning fresh via `gh repo clone` if the directory
 * is missing or isn't a git repo, else `git pull` to catch up. Throws on
 * failure (caller decides how to surface it — see pushToNeetRepo below,
 * which never lets this propagate as a submit-blocking error).
 */
export async function ensureSyncClone(repo: string): Promise<SyncCloneResult>
```

Self-healing: if the directory exists but `git rev-parse --show-toplevel`
inside it fails (corrupted, not a repo, wrong remote), it's removed and
re-cloned fresh rather than erroring — same "auto re-clone on any failure"
behavior as agreed. If the directory is missing entirely, straight clone.
Otherwise, `git pull` before returning.

### Writing the solution into the clone

Add a `pushToNeetRepo(problem, solutionCode)` helper (`src/sync-clone.ts` or
inline in `actions.ts`, next to `pushPathsToRepo` — implementer's call, see
plan) that:
1. Resolves `syncRepo` from config; if unset, returns a `PushResult`-shaped
   `{status: "no-repo"}` (new variant, or reuse `"not-a-repo"` — see plan for
   the exact decision) so `submitCurrent` can report "no sync repo
   configured" without treating it as an error.
2. Calls `ensureSyncClone(repo)`.
3. Writes the solution to `submissionPath(problem.slug, "cpp")` (reusing the
   existing helper from `pull-solutions.ts` — same NeetCode layout:
   `Data Structures & Algorithms/<slug>/submission-0.cpp`) inside the clone.
4. Calls the existing `pushPathsToRepo(cloneDir, [fullPath], commitMessage)`
   helper (from the prior `sync-upload-shortcut` work) to add/commit/push —
   reused as-is, no changes needed to that function.

### Wiring into `submitCurrent`

In `src/ui/actions.ts`, `submitCurrent`'s existing post-Accepted block (which
already pushes to the flat `gh` solutions repo) gets one more step: after
that push, also call `pushToNeetRepo` and append its outcome as another log
line in the same Logs transcript block — same pattern as the existing push
(switch over result status → human-readable line, never throwing, never
blocking the Accepted result).

### Dedup: shared `dataDir()`

Extract the identical `dataDir()` function (currently copy-pasted in
`config.ts`, `setup.ts`, `progress.ts`, `cache.ts`) into one shared location.
`config.ts` is the most natural home (it already exports config-path
resolution helpers) — export `dataDir` from there and have the other three
files import it instead of redefining it. `sync-clone.ts` imports it too
rather than adding a 5th copy.

## Out of scope

- No new hotkey — the neet-push happens automatically as part of `u`'s
  existing Accepted flow, no confirmation prompt (same as the gh push).
- No change to `pull-solutions` / "Pull solved from LeetCode" — those already
  satisfy "pull in recently solved."
- No change to `pushPathsToRepo`'s signature or behavior — reused as-is.

## Testing

- Unit test `ensureSyncClone`: fresh clone when missing, pull when present
  and valid, re-clone when present but corrupted (use real temp git repos +
  bare remotes, same style as the existing `pushPathsToRepo` tests).
- Unit test `pushToNeetRepo`: no-repo-configured case, and the write+push
  happy path against a real temp clone.
- Extend `submitCurrent`'s existing Accepted-path test (real temp git repos,
  same pattern as the gh-push test) to also assert the neet-repo commit
  landed.
- Extract `dataDir()`: no new test needed (pure refactor); existing tests for
  `config.ts`/`setup.ts`/`progress.ts`/`cache.ts` must keep passing unchanged.
