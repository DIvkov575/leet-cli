/**
 * Central network gate. Every function that reaches the network (LeetCode
 * GraphQL, the raw-CDN repo fetch, `gh`) calls `assertOnline()` first, so a
 * single switch guarantees the "offline" contract: with offline mode on, no
 * problem-data path can silently hit the network — it throws `OfflineError`
 * instead, and callers on the read path degrade to a clear message.
 *
 * Offline mode is enabled by the `LEET_OFFLINE` env var (any non-empty,
 * non-"0"/"false" value) or the `offline` config flag. Browsing, filtering,
 * fuzzy search, and roadmap generation never call the network at all, so they
 * work identically online or off.
 */

/** Thrown by `assertOnline` when a network call is attempted in offline mode. */
export class OfflineError extends Error {
  constructor(what: string) {
    super(
      `offline mode is on — can't ${what}. ` +
        `Pre-cache with \`leet setup\` while online, or unset LEET_OFFLINE / \`leet config offline --unset\`.`,
    );
    this.name = "OfflineError";
  }
}

/** True when the env var requests offline mode. */
function offlineFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.LEET_OFFLINE;
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

/**
 * Process-wide offline override, set once at startup from config (the env var is
 * always consulted independently). `null` means "config hasn't spoken", so only
 * the env var applies.
 */
let configOffline: boolean | null = null;

/** Record the config `offline` flag so `isOffline()` reflects it. Call at startup. */
export function setConfigOffline(value: boolean | undefined): void {
  configOffline = value ?? null;
}

/** True if offline mode is active (env var OR config flag). */
export function isOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  return offlineFromEnv(env) || configOffline === true;
}

/**
 * Throw `OfflineError` if offline mode is on. `what` completes the sentence
 * "can't <what>" (e.g. "fetch the statement from LeetCode"). Network functions
 * call this before any `fetch`/`spawn`.
 */
export function assertOnline(what: string): void {
  if (isOffline()) throw new OfflineError(what);
}
