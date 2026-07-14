import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";

/**
 * Completion tracking. Completed problems are stored by their global LeetCode
 * `id` in a single JSON file kept outside the repo, so it survives `refresh`
 * (which rewrites the bundled data) and is shared across every list — a
 * problem marked done in one list reads as done everywhere it appears.
 */

/** Directory holding user state. Honors LEET_DATA_DIR (used by tests), then XDG. */
function dataDir(): string {
  return (
    process.env.LEET_DATA_DIR ??
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "leet-cli")
  );
}

function progressPath(): string {
  return join(dataDir(), "completed.json");
}

/** Load the set of completed problem ids. Missing/garbage file -> empty set. */
export async function loadCompleted(): Promise<Set<number>> {
  const file = Bun.file(progressPath());
  if (!(await file.exists())) return new Set();
  try {
    const data = (await file.json()) as { completed?: unknown };
    const ids = Array.isArray(data?.completed) ? data.completed : [];
    return new Set(ids.filter((n): n is number => typeof n === "number"));
  } catch {
    return new Set();
  }
}

/**
 * Persist the set of completed problem ids (sorted, for stable diffs). The
 * write is atomic — a temp file is renamed over the target — so a crash
 * mid-write can't leave a truncated/corrupt completed.json.
 */
export async function saveCompleted(ids: Set<number>): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const completed = [...ids].sort((a, b) => a - b);
  const tmp = `${progressPath()}.tmp.${process.pid}`;
  await Bun.write(tmp, JSON.stringify({ completed }, null, 2) + "\n");
  await rename(tmp, progressPath());
}

function lockPath(): string {
  return `${progressPath()}.lock`;
}

/**
 * Acquire an exclusive on-disk lock via O_EXCL create, retrying if another
 * `leet` process holds it. Returns a release function. This serializes the
 * read-modify-write in `updateCompleted` so concurrent `leet done` calls can't
 * clobber each other's additions.
 *
 * Retries with a small randomized backoff (so contenders don't sync up) for up
 * to ~6s total. A lock older than `staleMs` is treated as abandoned (a killed
 * process) and stolen, so a crash can't wedge the tool forever.
 */
async function acquireLock(
  retries = 300,
  delayMs = 20,
  staleMs = 30_000,
): Promise<() => Promise<void>> {
  await mkdir(dataDir(), { recursive: true });
  const path = lockPath();
  const release = async () => {
    await unlink(path).catch(() => {});
  };
  for (let i = 0; i < retries; i++) {
    try {
      const fh = await open(path, "wx"); // fails if the lock file already exists
      await fh.close();
      return release;
    } catch {
      // Steal a stale lock left by a dead process.
      try {
        const st = await stat(path);
        if (Date.now() - st.mtimeMs > staleMs) {
          await unlink(path).catch(() => {});
          continue; // retry immediately after stealing
        }
      } catch {
        // lock vanished between open and stat — just retry
      }
      const jitter = delayMs + Math.floor(Math.random() * delayMs);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }
  // Couldn't get the lock in time; proceed anyway rather than hang.
  return release;
}

/**
 * Atomically read the completed set, apply `mutate`, and persist — under a file
 * lock so parallel invocations don't lose each other's writes. `mutate` may
 * change the set in place and/or return a new one; the effective set is saved.
 * Returns the saved set.
 */
export async function updateCompleted(
  mutate: (completed: Set<number>) => Set<number> | void,
): Promise<Set<number>> {
  const release = await acquireLock();
  try {
    const current = await loadCompleted();
    const next = mutate(current) ?? current;
    await saveCompleted(next);
    return next;
  } finally {
    await release();
  }
}
