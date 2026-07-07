#!/usr/bin/env bun
// Parse data/raw/<name>.txt (the raw pasted LeetCode format) into data/<name>.json.
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRawList } from "../src/parse.ts";
import type { ProblemList } from "../src/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "data", "raw");
const OUT_DIR = join(ROOT, "data");

// Human-readable titles per list name; falls back to the name if absent.
const TITLES: Record<string, string> = {
  "set-1": "Set 1",
  "set-2": "Set 2",
  uber: "Uber",
  nvidia: "NVIDIA",
  meta: "Meta",
};

const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith(".txt"));
for (const file of files) {
  const name = file.replace(/\.txt$/, "");
  const raw = await Bun.file(join(RAW_DIR, file)).text();
  const problems = parseRawList(raw);
  const list: ProblemList = { name, title: TITLES[name] ?? name, problems };
  await Bun.write(join(OUT_DIR, `${name}.json`), JSON.stringify(list, null, 2) + "\n");
  console.log(`${name}: ${problems.length} problems`);
}
