import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { embeddedCpp, embeddedDescription } from "./artifacts.ts";

/**
 * Local cache of packaged solution files (`<slug>.cpp` — description + stub +
 * harness). Solve writes here on every live fetch; prefetch fills it in bulk
 * from the repo. Kept outside the git repo under the same XDG dir as progress.
 *
 * Reads fall back to the compiled-in bundle (`artifacts.ts`) when a slug isn't
 * in the on-disk cache, so a freshly installed binary serves every bundled
 * problem's `.cpp` and statement with no network access.
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

/**
 * Return the packaged .cpp for a slug: the on-disk cache first (may hold a
 * refreshed copy), then the compiled-in bundle, else null. The bundle fallback
 * is what makes a fresh install offline-capable.
 */
export async function getCached(slug: string): Promise<string | null> {
  const file = Bun.file(cachePath(slug));
  if (await file.exists()) return file.text();
  return embeddedCpp(slug);
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
 * Return the problem statement (plain text shown in the preview): the on-disk
 * cache first, then the compiled-in bundle, else null. Stored separately from
 * the .cpp so the preview never has to hit LeetCode; the bundle fallback keeps
 * previews working offline on a fresh install.
 */
export async function getCachedDescription(slug: string): Promise<string | null> {
  const file = Bun.file(descPath(slug));
  if (await file.exists()) return file.text();
  return embeddedDescription(slug);
}

/** Write a slug's problem statement (plain text) into the cache. */
export async function putCachedDescription(slug: string, text: string): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  await Bun.write(descPath(slug), text);
}
