/**
 * Resolve a problem's statement as plain text with the fewest possible live
 * LeetCode calls. The lookup order is deliberately network-frugal:
 *
 *   1. local description cache (instant, offline)
 *   2. the packaged `.md` in the GitHub solutions repo (one cheap CDN GET)
 *   3. a live LeetCode GraphQL fetch (last resort)
 *
 * Whatever a step past the cache produces is written back to the cache, so a
 * given problem hits the network at most once ever. This is the shared path for
 * the TUI preview and `leet show`, keeping "usertime" LeetCode access minimal.
 */
import type { Problem } from "./types.ts";
import { getCachedDescription, putCachedDescription } from "./cache.ts";
import { fetchMarkdownFromRepo } from "./repo.ts";
import { fetchProblem } from "./leetcode.ts";
import { htmlToText } from "./render.ts";
import { isOffline } from "./net.ts";

/** Where a resolved description came from (for status/debug messaging). */
export type DescriptionSource = "cache" | "repo" | "live" | "offline";

export interface ResolvedDescription {
  text: string;
  source: DescriptionSource;
}

/**
 * Strip the packaged-markdown header (title + Difficulty/URL/Lists bullets) off
 * a `.md` file, leaving just the statement body. The header is a run of lines
 * starting with `#` or `- **…`; the body is everything after the first blank
 * line that follows it. If the shape isn't recognised, the whole thing is
 * returned rather than losing content.
 */
export function descriptionBodyFromMarkdown(md: string): string {
  const lines = md.split("\n");
  // No leading heading -> not our packaged shape; hand it back untouched rather
  // than risk trimming real content.
  if (lines.length === 0 || !lines[0]!.startsWith("#")) return md.trim();

  let i = 0;
  // Skip the "# id. title" heading and any blank lines under it.
  while (i < lines.length && (lines[i]!.startsWith("#") || lines[i]!.trim() === "")) i++;
  // Skip the metadata bullet block ("- **Difficulty:** …", etc.) if present.
  if (i < lines.length && lines[i]!.startsWith("- **")) {
    while (i < lines.length && lines[i]!.startsWith("- **")) i++;
    while (i < lines.length && lines[i]!.trim() === "") i++;
  }
  return lines.slice(i).join("\n").trim();
}

/**
 * Resolve `problem`'s statement text: cache → repo `.md` → live LeetCode, with
 * a write-back to the cache on any network hit. Throws only if the live fetch
 * itself fails (i.e. the problem isn't cached, isn't in the repo, and LeetCode
 * is unreachable or has no such slug).
 */
export async function resolveDescription(problem: Problem): Promise<ResolvedDescription> {
  const cached = await getCachedDescription(problem.slug);
  if (cached !== null) return { text: cached, source: "cache" };

  // Past the cache we need the network. In offline mode, don't attempt it —
  // return a clear, non-throwing placeholder so the preview degrades gracefully
  // instead of surprising the user with a fetch (or an error).
  if (isOffline()) {
    return {
      text:
        "(not cached — offline mode is on)\n\n" +
        "Run `leet setup` (or preview this problem once) while online to cache it.",
      source: "offline",
    };
  }

  const md = await fetchMarkdownFromRepo(problem.id, problem.slug);
  if (md !== null) {
    const text = descriptionBodyFromMarkdown(md);
    await putCachedDescription(problem.slug, text);
    return { text, source: "repo" };
  }

  const remote = await fetchProblem(problem.slug, { withContent: true });
  const text = remote.contentHtml ? htmlToText(remote.contentHtml) : "(no statement available)";
  await putCachedDescription(problem.slug, text);
  return { text, source: "live" };
}
