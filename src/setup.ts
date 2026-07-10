import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadList } from "./lib.ts";
import { prefetchProblems, type PrefetchResult } from "./prefetch.ts";

/**
 * Proactive pre-caching of a study set so the first `solve`/preview is instant
 * and offline-capable. Shared by the npm `postinstall` hook (scripts/setup.ts)
 * and the compiled binary's first-run trigger (Homebrew has no postinstall).
 *
 * A marker file records that setup ran, so the binary only auto-caches once.
 */

const DEFAULT_LIST = "neetcode-250";

function dataDir(): string {
  return (
    process.env.LEET_DATA_DIR ??
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "leet-cli")
  );
}

function markerPath(): string {
  return join(dataDir(), ".setup-done");
}

/** True once setup has run (marker present). */
export async function setupHasRun(): Promise<boolean> {
  return Bun.file(markerPath()).exists();
}

/** Record that setup ran, so first-run auto-caching won't fire again. */
export async function markSetupDone(): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await Bun.write(markerPath(), new Date().toISOString() + "\n");
}

export interface SetupOptions {
  /** Bundled list to pre-cache (default neetcode-250, or $LEET_SETUP_LIST). */
  list?: string;
  onProgress?: (done: number, total: number, slug: string) => void;
  /** Abort check; stops the prefetch loop early (used by the TUI trigger). */
  shouldStop?: () => boolean;
}

export interface SetupResult extends PrefetchResult {
  list: string;
  total: number;
}

/**
 * Pre-cache the study set. Always writes the marker afterward (even on partial
 * failure) so it doesn't retry forever. Throws only if the list can't load.
 */
export async function runSetup(opts: SetupOptions = {}): Promise<SetupResult> {
  const list = opts.list ?? process.env.LEET_SETUP_LIST ?? DEFAULT_LIST;
  const problems = (await loadList(list)).problems;
  const result = await prefetchProblems(problems, {
    onProgress: opts.onProgress,
    shouldStop: opts.shouldStop,
  });
  await markSetupDone();
  return { ...result, list, total: problems.length };
}
