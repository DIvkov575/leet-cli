#!/usr/bin/env bun
/**
 * Build artifacts/bundle.json: a single JSON blob mapping every bundled
 * problem's slug → { cpp, desc }, generated locally from live LeetCode data
 * using the exact same scaffolding path `leet solve`/`leet test` use at
 * runtime (scaffoldContent → resolveHarness → generateHarness/custom-harness).
 *
 *   - `cpp`  is the packaged editable file (statement embedded as a `//` block,
 *            stub, and test harness) — exactly what `leet solve` scaffolds.
 *   - `desc` is the plain-text statement body, what the TUI preview and
 *            `leet show` display.
 *
 * The bundle is committed and statically imported (src/artifacts.ts), so
 * `bun build --compile` embeds it into the standalone binary. A freshly
 * installed `leet` then serves previews, scaffolds, and tests entirely from the
 * embedded bundle — zero network — for every problem across the bundled lists.
 *
 * Generating locally (rather than downloading pre-packaged files from the
 * solutions repo) means the bundle always reflects the current harness code —
 * re-run this (with a network connection) whenever the bundled lists change OR
 * whenever harness.ts/custom-harness.ts/scaffold.ts change:
 *   bun run build:artifacts
 *
 * This script is the ONLY step that touches the network, and it's a
 * build-time step, not a runtime one.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EMBEDDED_LISTS } from "../src/lists.generated.ts";
import { fetchProblem } from "../src/leetcode.ts";
import { scaffoldContent } from "../src/scaffold.ts";
import { htmlToText } from "../src/render.ts";
import type { Problem } from "../src/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "artifacts", "bundle.json");

interface Artifact {
  cpp?: string;
  desc?: string;
}

// Start from whatever's already committed, so a slug that fails after
// retries (rate-limited, or LeetCode briefly unreachable) keeps its last-good
// entry instead of dropping out of the bundle entirely.
const existing: Record<string, Artifact> = await Bun.file(OUT)
  .json()
  .catch(() => ({}));

// De-duplicated union of every bundled list (first occurrence wins), by id order.
const byId = new Map<number, Problem>();
for (const list of Object.values(EMBEDDED_LISTS)) {
  for (const p of list.problems) if (!byId.has(p.id)) byId.set(p.id, p);
}
const problems = [...byId.values()].sort((a, b) => a.id - b.id);

console.log(`building artifacts for ${problems.length} unique problems…`);

const bundle: Record<string, Artifact> = {};
let withCpp = 0;
let withDesc = 0;
let missing = 0;
const failedSlugs: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serial with a fixed pause between requests, plus retry/backoff on failure —
// LeetCode's GraphQL endpoint rate-limits aggressively; a first attempt at
// concurrency=8 with no delay got most of the way through before every
// remaining request started timing out/refusing the connection.
const REQUEST_DELAY_MS = 800;
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 5_000;

async function fetchWithRetry(slug: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchProblem(slug, { withSnippets: true, withContent: true });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      const wait = RETRY_BASE_MS * 2 ** attempt;
      console.error(
        `  ! ${slug}: ${err instanceof Error ? err.message : String(err)} — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(wait / 1000)}s`,
      );
      await sleep(wait);
    }
  }
}

for (let i = 0; i < problems.length; i++) {
  const p = problems[i]!;
  try {
    const r = await fetchWithRetry(p.slug);
    const hasCpp = (r.snippets ?? []).some((s) => s.langSlug === "cpp");
    // Problems with no usable C++ scaffold: paid-only (no content/snippets
    // without a subscription) or SQL/JS-only problems (content, but no C++
    // snippet). Write an explicit placeholder (matching packageMissing's shape
    // in src/package.ts) rather than omitting the slug, so a fresh install
    // still shows *why* offline — instead of the runtime falling through to a
    // live fetch that will just fail the same way for every user who hits it.
    if (r.isPaidOnly || !r.contentHtml || !hasCpp) {
      const reason = r.isPaidOnly ? "premium" : "no content";
      const detail = r.isPaidOnly
        ? "LeetCode Premium — no starter code without a subscription"
        : "LeetCode returned no C++ starter code for this problem";
      bundle[p.slug] = {
        cpp:
          `// ${r.id}. ${r.title} [${r.difficulty}]\n` +
          `// https://leetcode.com/problems/${r.slug}/\n` +
          `// NO C++ STARTER AVAILABLE (${reason}): ${detail}\n` +
          `// This problem cannot be scaffolded as C++.\n`,
        desc: `_No description available._\n\n> **No C++ starter available** (${reason}): ${detail}`,
      };
      missing++;
    } else {
      const art: Artifact = {};
      art.cpp = scaffoldContent({
        id: r.id,
        title: r.title,
        slug: r.slug,
        difficulty: r.difficulty,
        url: `https://leetcode.com/problems/${r.slug}/`,
        snippets: r.snippets ?? [],
        metaData: r.metaData,
        exampleTestcases: r.exampleTestcases,
        contentHtml: r.contentHtml,
      });
      withCpp++;
      art.desc = htmlToText(r.contentHtml);
      withDesc++;
      bundle[p.slug] = art;
    }
  } catch (err) {
    missing++;
    failedSlugs.push(p.slug);
    console.error(`  ! ${p.slug}: gave up — ${err instanceof Error ? err.message : String(err)}`);
    if (existing[p.slug]) bundle[p.slug] = existing[p.slug]!; // keep the last-good entry
  }
  if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${problems.length}`);
  await sleep(REQUEST_DELAY_MS);
}

if (failedSlugs.length > 0) {
  console.log(`\n${failedSlugs.length} slug(s) failed after retries:\n  ${failedSlugs.join("\n  ")}`);
}

// Key the bundle in a stable (sorted) order so re-runs produce minimal diffs.
const sorted: Record<string, Artifact> = {};
for (const slug of Object.keys(bundle).sort()) sorted[slug] = bundle[slug]!;

await Bun.write(OUT, JSON.stringify(sorted) + "\n");
const bytes = (await Bun.file(OUT).text()).length;
console.log(
  `wrote ${OUT}: ${Object.keys(sorted).length} problems ` +
    `(${withCpp} with cpp, ${withDesc} with desc, ${missing} unavailable), ${(bytes / 1024 / 1024).toFixed(2)} MB`,
);
