#!/usr/bin/env bun
/**
 * Post-install setup: proactively cache a study set (default NeetCode 250) so
 * the first `leet solve` / preview is instant and offline-capable.
 *
 * Runs as `bun run setup` and (best-effort) as an npm/bun `postinstall` hook.
 * Deliberately non-fatal: any failure (offline, CI, no network) prints a note
 * and exits 0 so it never blocks installation. Skip with LEET_NO_SETUP=1.
 */
import { runSetup } from "../src/setup.ts";

async function main(): Promise<void> {
  if (process.env.LEET_NO_SETUP) {
    console.log("leet: setup skipped (LEET_NO_SETUP set).");
    return;
  }

  const start = performance.now();
  let announced = false;
  const result = await runSetup({
    onProgress: (done, total, slug) => {
      if (!announced) {
        console.log(`leet: pre-caching ${total} problems (Ctrl-C to skip)…`);
        announced = true;
      }
      if (done % 25 === 0 || done === total) console.log(`  [${done}/${total}] ${slug}`);
    },
  });
  const secs = ((performance.now() - start) / 1000).toFixed(0);
  console.log(
    `leet: cached ${result.fromRepo + result.fromLeet} problems from "${result.list}" ` +
      `(${result.fromRepo} from repo, ${result.fromLeet} live), ` +
      `${result.skipped} already cached, ${result.failed} unavailable — in ${secs}s.`,
  );
}

// Never fail the install: swallow everything and exit 0.
main().catch((err) => {
  console.log(`leet: setup skipped — ${err instanceof Error ? err.message : String(err)}`);
});
