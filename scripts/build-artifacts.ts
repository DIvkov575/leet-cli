#!/usr/bin/env bun
/**
 * Build artifacts/bundle.json: a single JSON blob mapping every bundled
 * problem's slug → { cpp, desc }, sourced once from the public solutions repo.
 *
 *   - `cpp`  is the packaged editable file (statement embedded as a `//` block,
 *            stub, and test harness) — exactly what `leet solve` scaffolds.
 *   - `desc` is the plain-text statement body (from the packaged `.md`), what
 *            the TUI preview and `leet show` display.
 *
 * The bundle is committed and statically imported (src/artifacts.ts), so
 * `bun build --compile` embeds it into the standalone binary. A freshly
 * installed `leet` then serves previews, scaffolds, and tests entirely from the
 * embedded bundle — zero network — for every problem across the bundled lists.
 *
 * This script is the ONLY step that touches the network, and it's a build-time
 * step, not a runtime one. Re-run it (with a network connection) whenever the
 * bundled lists or the solutions repo change:  `bun run build:artifacts`.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EMBEDDED_LISTS } from "../src/lists.generated.ts";
import { repoCppPath, repoMdPath, repoRawUrlFor } from "../src/repo.ts";
import { descriptionBodyFromMarkdown } from "../src/description.ts";
import type { Problem } from "../src/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "artifacts", "bundle.json");

interface Artifact {
  cpp?: string;
  desc?: string;
}

/** GET a repo-relative file over the raw CDN, or null on 404/empty. */
async function get(path: string): Promise<string | null> {
  const res = await fetch(repoRawUrlFor(path), { headers: { "User-Agent": "leet-cli-build" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch ${path} failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return text.length > 0 ? text : null;
}

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
// Bounded concurrency so we don't hammer the CDN.
const CONCURRENCY = 12;
let cursor = 0;

async function worker(): Promise<void> {
  while (cursor < problems.length) {
    const p = problems[cursor++]!;
    try {
      const [cpp, md] = await Promise.all([
        get(repoCppPath(p.id, p.slug)),
        get(repoMdPath(p.id, p.slug)),
      ]);
      const art: Artifact = {};
      if (cpp) {
        art.cpp = cpp;
        withCpp++;
      }
      if (md) {
        art.desc = descriptionBodyFromMarkdown(md);
        withDesc++;
      }
      if (art.cpp || art.desc) bundle[p.slug] = art;
      else missing++;
    } catch (err) {
      missing++;
      console.error(`  ! ${p.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (cursor % 50 === 0) console.log(`  …${cursor}/${problems.length}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

// Key the bundle in a stable (sorted) order so re-runs produce minimal diffs.
const sorted: Record<string, Artifact> = {};
for (const slug of Object.keys(bundle).sort()) sorted[slug] = bundle[slug]!;

await Bun.write(OUT, JSON.stringify(sorted) + "\n");
const bytes = (await Bun.file(OUT).text()).length;
console.log(
  `wrote ${OUT}: ${Object.keys(sorted).length} problems ` +
    `(${withCpp} with cpp, ${withDesc} with desc, ${missing} unavailable), ${(bytes / 1024 / 1024).toFixed(2)} MB`,
);
