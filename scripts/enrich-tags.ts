#!/usr/bin/env bun
/**
 * Enrich every bundled list in data/ with NeetCode pattern tags + LeetCode
 * topic tags, in place. Reads the pre-collected slug → {neetcodePattern, topics}
 * artifact (scripts/data/tags-source.json) and runs each problem through
 * resolveTags(), writing `pattern`, `patternSource`, and `topics` onto it.
 *
 * The artifact is committed so this is offline and reproducible. To refresh the
 * artifact itself (new problems / re-scrape NeetCode + LeetCode), see
 * scripts/collect-tags.ts.
 *
 * Run: bun run scripts/enrich-tags.ts   (then `bun run build:data` to re-embed)
 */
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ProblemList } from "../src/types.ts";
import { resolveTags } from "../src/tags.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const ARTIFACT = join(ROOT, "scripts", "data", "tags-source.json");

type TagSource = Record<string, { neetcodePattern: string | null; topics: string[] }>;
const source = (await Bun.file(ARTIFACT).json()) as TagSource;

const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
let enriched = 0;
let missing = 0;
const missingSlugs = new Set<string>();

for (const file of files) {
  const path = join(DATA_DIR, file);
  const list = (await Bun.file(path).json()) as ProblemList;
  for (const p of list.problems) {
    const src = source[p.slug];
    if (!src) {
      missing++;
      missingSlugs.add(p.slug);
      continue;
    }
    const { pattern, patternSource, topics } = resolveTags(src.neetcodePattern, src.topics);
    if (pattern) {
      p.pattern = pattern;
      p.patternSource = patternSource;
    } else {
      delete p.pattern;
      delete p.patternSource;
    }
    p.topics = topics;
    enriched++;
  }
  await Bun.write(path, JSON.stringify(list, null, 2) + "\n");
}

console.log(`enriched ${enriched} problem entries across ${files.length} lists`);
if (missing > 0) {
  console.log(`no tag data for ${missingSlugs.size} slug(s) (${missing} entries):`);
  console.log("  " + [...missingSlugs].sort().join(", "));
}
