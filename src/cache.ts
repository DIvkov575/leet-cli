import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Local cache of packaged solution files (`<slug>.cpp` — description + stub +
 * harness). Solve writes here on every live fetch; prefetch fills it in bulk
 * from the repo. Kept outside the git repo under the same XDG dir as progress.
 */

/** Directory holding user state. Honors LEET_DATA_DIR (used by tests), then XDG. */
function dataDir(): string {
  return (
    process.env.LEET_DATA_DIR ??
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "leet-cli")
  );
}

/** Directory holding cached solution files. */
export function cacheDir(): string {
  return join(dataDir(), "cache");
}

/** Cache file path for a slug's packaged .cpp. */
function cachePath(slug: string): string {
  return join(cacheDir(), `${slug}.cpp`);
}

/** Cache file path for a slug's problem statement (plain text). */
function descPath(slug: string): string {
  return join(cacheDir(), `${slug}.md`);
}

/** Return the cached .cpp content for a slug, or null if not cached. */
export async function getCached(slug: string): Promise<string | null> {
  const file = Bun.file(cachePath(slug));
  if (!(await file.exists())) return null;
  return file.text();
}

/** Write a slug's packaged .cpp into the cache. */
export async function putCached(slug: string, content: string): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  await Bun.write(cachePath(slug), content);
}

/** True if the slug is already cached. */
export async function isCached(slug: string): Promise<boolean> {
  return Bun.file(cachePath(slug)).exists();
}

/**
 * Return the cached problem statement (the plain-text description shown in the
 * preview), or null if not cached. Stored separately from the .cpp so the
 * preview never has to hit LeetCode once a description has been seen.
 */
export async function getCachedDescription(slug: string): Promise<string | null> {
  const file = Bun.file(descPath(slug));
  if (!(await file.exists())) return null;
  return file.text();
}

/** Write a slug's problem statement (plain text) into the cache. */
export async function putCachedDescription(slug: string, text: string): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  await Bun.write(descPath(slug), text);
}
