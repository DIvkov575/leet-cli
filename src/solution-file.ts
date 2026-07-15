/**
 * Single source of truth for building the editable solution `.cpp` a user
 * works in. Every construction site (`leet solve`, `leet test`, the TUI's
 * scaffold key) goes through here so the guarantee holds everywhere:
 *
 *   the file that lands on disk ALWAYS has the problem statement embedded as a
 *   leading `//` comment block (when a statement exists at all).
 *
 * This matters because scaffolding is cache-first: a `.cpp` packaged before
 * description-embedding lives in the cache and would otherwise be copied to
 * disk verbatim, statement-less. `ensureStatement` heals that: if the content
 * lacks the block, it resolves the statement (cache → repo → live, via
 * `resolveDescription`) and splices it in, then re-writes the cache so the fix
 * is permanent. Idempotent: content that already has the block is returned
 * untouched.
 */
import type { Problem } from "./types.ts";
import { getCached, putCached } from "./cache.ts";
import { resolveDescription } from "./description.ts";
import { commentLinesFromText } from "./render.ts";
import { isOffline, OfflineError } from "./net.ts";

/** Length of the leading run of `//` header lines. */
function headerEnd(lines: string[]): number {
  let i = 0;
  while (i < lines.length && lines[i]!.startsWith("//")) i++;
  return i;
}

/**
 * True if `cpp`'s header already carries a statement block. The header is the
 * `//` run at the top; a bare `//` separator line within it marks the start of
 * an embedded statement (the id/url header alone has no such separator).
 */
export function hasStatementBlock(cpp: string): boolean {
  const lines = cpp.split("\n");
  return lines.slice(0, headerEnd(lines)).some((l) => l === "//");
}

/**
 * Return `cpp` with the statement embedded after the id/url header. `statement`
 * is already-plain text (as from `resolveDescription`). No-op (returns the
 * input) when the block is already present or the statement is empty.
 */
export function withStatement(cpp: string, statement: string): string {
  if (hasStatementBlock(cpp)) return cpp;
  const block = commentLinesFromText(statement, "// ");
  if (block.length === 0) return cpp;
  const lines = cpp.split("\n");
  const end = headerEnd(lines);
  return [...lines.slice(0, end), "//", ...block, ...lines.slice(end)].join("\n");
}

/**
 * Ensure `cpp` (freshly scaffolded or read from cache) has the statement block.
 * If it doesn't, resolve the statement for `problem` and splice it in; on a
 * successful heal the cache entry is rewritten so the next scaffold is already
 * correct. Returns the (possibly upgraded) content. Never throws — if the
 * statement can't be resolved (offline + never seen, premium), the input is
 * returned as-is.
 */
export async function ensureStatement(cpp: string, problem: Problem): Promise<string> {
  if (hasStatementBlock(cpp)) return cpp;
  let statement = "";
  try {
    statement = (await resolveDescription(problem)).text;
  } catch {
    return cpp; // unresolved (offline/premium) — leave content untouched
  }
  const upgraded = withStatement(cpp, statement);
  if (upgraded !== cpp) await putCached(problem.slug, upgraded).catch(() => {});
  return upgraded;
}

/**
 * The full editable `.cpp` for `problem`, guaranteed to carry the statement.
 * Cache-first (`getCached`), healed via `ensureStatement`. When the cache
 * misses, `scaffoldFresh` supplies freshly-packaged content (which already
 * embeds the statement) and it's cached for next time.
 */
export async function buildSolutionFile(
  problem: Problem,
  scaffoldFresh: () => Promise<string>,
): Promise<string> {
  const cached = await getCached(problem.slug);
  if (cached !== null) return ensureStatement(cached, problem);
  // Cache miss needs the network to package the stub. In offline mode, surface a
  // clear error rather than letting the underlying fetch throw a raw OfflineError
  // mid-scaffold — the CLI/TUI turn this into an actionable message.
  if (isOffline()) {
    throw new OfflineError(`scaffold ${problem.slug} (not cached)`);
  }
  const fresh = await scaffoldFresh();
  await putCached(problem.slug, fresh).catch(() => {});
  return ensureStatement(fresh, problem); // belt-and-suspenders
}
