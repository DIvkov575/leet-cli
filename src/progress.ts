import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

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

/** Persist the set of completed problem ids (sorted, for stable diffs). */
export async function saveCompleted(ids: Set<number>): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const completed = [...ids].sort((a, b) => a - b);
  await Bun.write(progressPath(), JSON.stringify({ completed }, null, 2) + "\n");
}
