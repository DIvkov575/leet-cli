#!/usr/bin/env bun
/**
 * Post-install setup: proactively cache a study set so the first `leet solve`
 * / preview is instant offline. Defaults to the NeetCode 250 list.
 *
 * Runs as `bun run setup` and (best-effort) as an npm/bun `postinstall` hook.
 * It is deliberately non-fatal: any failure (offline install, CI, no network)
 * prints a note and exits 0 so it never blocks installation. Skip entirely with
 * LEET_NO_SETUP=1.
 */
import { loadList } from "../src/lib.ts";
import { prefetchProblems } from "../src/prefetch.ts";

const LIST = process.env.LEET_SETUP_LIST ?? "neetcode-250";

async function main(): Promise<void> {
  if (process.env.LEET_NO_SETUP) {
    console.log("leet: setup skipped (LEET_NO_SETUP set).");
    return;
  }

  let problems;
  try {
    problems = (await loadList(LIST)).problems;
  } catch (err) {
    console.log(`leet: setup skipped — could not load "${LIST}": ${err instanceof Error ? err.message : err}`);
    return;
  }

  console.log(`leet: pre-caching ${problems.length} problems from "${LIST}" (Ctrl-C to skip)…`);
  const start = performance.now();
  const result = await prefetchProblems(problems, {
    onProgress: (done, total, slug) => {
      if (done % 25 === 0 || done === total) {
        console.log(`  [${done}/${total}] ${slug}`);
      }
    },
  });
  const secs = ((performance.now() - start) / 1000).toFixed(0);
  console.log(
    `leet: cached ${result.fromRepo + result.fromLeet} problems ` +
      `(${result.fromRepo} from repo, ${result.fromLeet} live), ` +
      `${result.skipped} already cached, ${result.failed} unavailable — in ${secs}s.`,
  );
}

// Never fail the install: swallow everything and exit 0.
main().catch((err) => {
  console.log(`leet: setup skipped — ${err instanceof Error ? err.message : String(err)}`);
});
