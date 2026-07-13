#!/usr/bin/env bun
import { parseArgs } from "node:util";
import {
  availableLists,
  filterProblems,
  findProblem,
  findProblemAnywhere,
  loadList,
  pickRandom,
  saveList,
  sortProblems,
  type Difficulty,
  type FilterOptions,
  type Problem,
  type SortKey,
} from "./lib.ts";
import { fetchProblem, fetchProblems } from "./leetcode.ts";
import { scaffoldContent, scaffoldFilename } from "./scaffold.ts";
import { collectTargets, syncTargets, missingManifest } from "./sync.ts";
import { getCached, putCached } from "./cache.ts";
import { htmlToText, renderProblem, renderTable } from "./render.ts";
import { loadCompleted, saveCompleted } from "./progress.ts";
import {
  loadConfig,
  saveConfig,
  resolveEditor,
  resolveSolutionsDir,
  resolveCxx,
  resolveLeetCodeAuth,
  CONFIG_FIELDS,
} from "./config.ts";
import { importSource } from "./import.ts";
import { adapterNames } from "./adapters.ts";
import { RECOMMEND_STRATEGIES } from "./recommend.ts";
import { runSetup } from "./setup.ts";
import { fetchSolvedSlugs } from "./leetcode-progress.ts";
import { submitSolution } from "./leetcode-submit.ts";
import { fetchNeetcodeCpp } from "./neetcode.ts";
import { authFromBrowser } from "./auth.ts";
import { runTui } from "./tui.ts";
import { version as VERSION } from "../package.json";

const HELP = `leet ${VERSION} — browse bundled LeetCode company lists from the terminal

Usage:
  leet                             Open the interactive browser (pick lists, filter, preview…)
  leet tui [list]                  Same, optionally starting on a specific list
  leet lists                       List the bundled problem lists
  leet ls <list> [filters]         Print a list as a table
  leet show <id|slug> [--live]     Show one problem (--live fetches the statement)
  leet solve <id|slug> [-o]        Scaffold a runnable C++ file (cache-first); -o opens it ($VISUAL/$EDITOR, else nvim/vim/vi)
  leet test <id|slug>              Compile the scaffolded solution and run its test harness
  leet push [--source neetcode|dir] Submit solutions to LeetCode to mark them Accepted (--yes to apply)
  leet sync <owner/repo> [list...] Package all problems (desc + stub + tests) into a private GitHub repo
  leet open <id|slug> [list]       Open a problem in the browser
  leet random [list] [filters]     Print one random problem
  leet done [id|slug ...]          Mark problems done, or list what's done
  leet undone <id|slug ...>        Unmark problems as done
  leet import <path|owner/repo>    Mark done from a NeetCode sync (or --adapter leetcode)
  leet auth                        Grab your LeetCode session from a local browser (Firefox/Chrome)
  leet refresh <list|--all>        Refresh acceptance/difficulty from LeetCode
  leet config [key value|--unset]  Show or set settings (editor, solutionsDir, cxx, recommend)
  leet setup [--list <name>]       Pre-cache a study set (default neetcode-250) for offline solve
  leet version                     Print the version (also --version, -v)

Filters (for ls / random):
  --difficulty, -d  easy|medium|hard
  --min-acc <n>     minimum acceptance %        --max-acc <n>  maximum acceptance %
  --search, -s <q>  title substring match
  --done            only completed problems     --todo         only not-completed
  --sort <key>      id|acc|difficulty|title (default id)   --desc  reverse order
  --limit, -n <n>   cap the number of rows
  --json            emit JSON instead of a table

Examples:
  leet ls nvidia -d hard --sort acc
  leet ls uber --search tree --limit 20
  leet ls uber --todo              # what's left to do in the uber list
  leet done 42 two-sum             # mark problems as completed
  leet import you/neetcode-submissions-xxxx            # mark done from a NeetCode GitHub sync
  leet import ~/code/neetcode --dry-run                 # preview from a local clone
  LEETCODE_SESSION=… leet import --adapter leetcode     # resync solved from your LeetCode account
  leet random uber -d medium
  leet show 42 --live
  leet solve two-sum              # write solutions/1-two-sum.cpp
  leet refresh nvidia

import options:
  --adapter <name>  source format (default neetcode)
  --ref <ref>       git ref/branch/sha for a GitHub source (default: default branch)
  --dry-run         report what would be marked without saving`;

/** Written to the solutions repo so cloners know how to run the tests. */
const REPO_README = `# LeetCode / NeetCode solutions

Synced by [leet-cli](https://github.com/DIvkov575/leet-cli). Each problem has:

- \`<id>-<slug>.md\` — the problem statement
- \`<id>-<slug>.cpp\` — the C++ starter stub **plus an embedded test harness**
- \`<id>-<slug>.tests.txt\` — the raw example test cases

## How to test a solution

1. Open the \`.cpp\` file and fill in the \`Solution\` method body.
2. Compile and run it — the file has its own \`main()\` that runs the example
   cases and prints pass/fail:

   \`\`\`sh
   c++ -std=c++17 1-two-sum.cpp -o /tmp/sol && /tmp/sol
   \`\`\`

   Output looks like:

   \`\`\`
   case 1: PASS  got=[0,1]
   case 2: PASS  got=[1,2]
   3/3 passed
   \`\`\`

Cases where the expected output could not be parsed print \`ran  got=...\`
instead of PASS/FAIL, so you can still eyeball the result. Problems whose
signatures the generator can't yet emit (linked lists, trees) contain the
example cases as a comment instead of a runnable harness.

Some problems have no official C++ starter (LeetCode Premium, SQL/Database, or
JavaScript-only). For Premium ones a community C++ solution from
[neetcode-gh/leetcode](https://github.com/neetcode-gh/leetcode) is substituted
where available (noted in the file header); the rest carry a placeholder \`.cpp\`
explaining why. See \`MISSING.md\` for the full list, grouped by reason.

## Shortcuts

- \`leet solve <slug> -o\` scaffolds a problem locally (cache-first) and opens
  it in your editor.
- \`leet test <slug>\` compiles the scaffolded solution and runs its harness
  (exits non-zero if any case fails).
`;

const DIFFICULTY_ALIASES: Record<string, Difficulty> = {
  easy: "Easy",
  e: "Easy",
  med: "Medium",
  medium: "Medium",
  m: "Medium",
  hard: "Hard",
  h: "Hard",
};

function parseDifficulty(v: string | undefined): Difficulty | undefined {
  if (v === undefined) return undefined;
  const d = DIFFICULTY_ALIASES[v.toLowerCase()];
  if (!d) throw new UserError(`invalid --difficulty "${v}" (use easy|medium|hard)`);
  return d;
}

function parseSort(v: string | undefined): SortKey {
  const allowed: SortKey[] = ["id", "acc", "difficulty", "title"];
  if (v === undefined) return "id";
  if (!allowed.includes(v as SortKey)) {
    throw new UserError(`invalid --sort "${v}" (use ${allowed.join("|")})`);
  }
  return v as SortKey;
}

class UserError extends Error {}

const FILTER_OPTIONS = {
  difficulty: { type: "string", short: "d" },
  "min-acc": { type: "string" },
  "max-acc": { type: "string" },
  search: { type: "string", short: "s" },
  done: { type: "boolean" },
  todo: { type: "boolean" },
  sort: { type: "string" },
  desc: { type: "boolean" },
  limit: { type: "string", short: "n" },
  json: { type: "boolean" },
} as const;

interface Parsed {
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

function parse(argv: string[], extra: Record<string, unknown> = {}): Parsed {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { ...FILTER_OPTIONS, ...(extra as typeof FILTER_OPTIONS) },
  });
  return { positionals, values: values as Parsed["values"] };
}

function num(v: string | boolean | undefined, flag: string): number | undefined {
  if (v === undefined || typeof v === "boolean") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UserError(`${flag} must be a number, got "${v}"`);
  return n;
}

function filtersFrom(values: Parsed["values"], completed?: Set<number>): FilterOptions {
  if (values.done && values.todo) {
    throw new UserError("--done and --todo are mutually exclusive");
  }
  const done = values.done ? true : values.todo ? false : undefined;
  return {
    difficulty: parseDifficulty(values.difficulty as string | undefined),
    minAcceptance: num(values["min-acc"], "--min-acc"),
    maxAcceptance: num(values["max-acc"], "--max-acc"),
    search: values.search as string | undefined,
    completed,
    done,
  };
}

function applyView(problems: Problem[], values: Parsed["values"], completed: Set<number>): Problem[] {
  let out = filterProblems(problems, filtersFrom(values, completed));
  out = sortProblems(out, parseSort(values.sort as string | undefined), Boolean(values.desc));
  const limit = num(values.limit, "--limit");
  if (limit !== undefined) out = out.slice(0, limit);
  return out;
}

function output(problems: Problem[], values: Parsed["values"], completed: Set<number>): void {
  if (values.json) {
    console.log(JSON.stringify(problems, null, 2));
  } else {
    console.log(renderTable(problems, completed));
  }
}

async function openUrl(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited;
}

/** Open a file in the user's editor (config > $VISUAL/$EDITOR, else best installed), inheriting the tty. */
async function openInEditor(path: string): Promise<void> {
  // config `editor` > $VISUAL > $EDITOR; otherwise pick the best one installed.
  const editor =
    resolveEditor(await loadConfig()) ||
    ["nvim", "vim", "vi"].find((e) => Bun.which(e)) ||
    "vi";
  // Split on spaces so EDITOR="code -w" style values work.
  const parts = editor.split(/\s+/).filter(Boolean);
  await Bun.spawn([...parts, path], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
}

async function cmdLists(): Promise<void> {
  const names = await availableLists();
  const width = Math.max(0, ...names.map((n) => n.length));
  for (const name of names) {
    const list = await loadList(name);
    console.log(`${name.padEnd(width)} ${String(list.problems.length).padStart(4)}  ${list.title}`);
  }
}

async function cmdLs(p: Parsed): Promise<void> {
  const name = p.positionals[0];
  if (!name) throw new UserError("usage: leet ls <list> [filters]");
  const list = await loadList(name);
  const completed = await loadCompleted();
  output(applyView(list.problems, p.values, completed), p.values, completed);
}

/**
 * `leet config` — show settings; `leet config <key> <value>` sets one;
 * `leet config <key> --unset` clears it. Keys: editor, solutionsDir, cxx, recommend.
 */
async function cmdConfig(p: Parsed): Promise<void> {
  const cfg = await loadConfig();
  const [key, ...valueParts] = p.positionals;

  if (!key) {
    for (const f of CONFIG_FIELDS) {
      const v = cfg[f.key];
      console.log(`${f.key.padEnd(14)} ${v ? v : `(unset — ${f.fallback})`}`);
    }
    return;
  }

  const field = CONFIG_FIELDS.find((f) => f.key === key);
  if (!field) {
    throw new UserError(`unknown config key "${key}" (keys: ${CONFIG_FIELDS.map((f) => f.key).join(", ")})`);
  }

  if (p.values.unset) {
    delete cfg[field.key];
    await saveConfig(cfg);
    console.log(`unset ${field.key}`);
    return;
  }

  const value = valueParts.join(" ").trim();
  if (!value) throw new UserError(`usage: leet config ${field.key} <value>   (or --unset)`);
  if (field.key === "recommend" && !RECOMMEND_STRATEGIES[value]) {
    throw new UserError(
      `unknown recommend strategy "${value}" (options: ${Object.keys(RECOMMEND_STRATEGIES).join(", ")})`,
    );
  }
  cfg[field.key] = value;
  await saveConfig(cfg);
  console.log(`${field.key} = ${value}`);
}

/**
 * `leet setup [--list <name>]` — pre-cache a study set (default neetcode-250)
 * so solve/preview is instant offline. Also runs automatically on first launch.
 */
async function cmdSetup(p: Parsed): Promise<void> {
  const list = p.values.list as string | undefined;
  let announced = false;
  const result = await runSetup({
    list,
    onProgress: (done, total, slug) => {
      if (!announced) {
        console.error(`pre-caching ${total} problems from "${list ?? "neetcode-250"}"…`);
        announced = true;
      }
      if (done % 25 === 0 || done === total) console.error(`  [${done}/${total}] ${slug}`);
    },
  });
  console.log(
    `cached ${result.fromRepo + result.fromLeet} of ${result.total} ` +
      `(${result.fromRepo} from repo, ${result.fromLeet} live, ${result.skipped} already, ${result.failed} unavailable).`,
  );
}

/**
 * `leet auth` — grab your LeetCode session cookie from a local browser and save
 * it to config, so `leet import --adapter leetcode` works without hand-copying.
 * Tries Firefox (plaintext cookie DB) then Chrome (Keychain-decrypted); some
 * recent Chrome builds use app-bound encryption we can't read.
 */
async function cmdAuth(p: Parsed): Promise<void> {
  const onlyChrome = Boolean(p.values["from-chrome"]);
  const onlyFirefox = Boolean(p.values["from-firefox"]);
  const sources: Array<"firefox" | "chrome"> =
    onlyChrome ? ["chrome"] : onlyFirefox ? ["firefox"] : ["firefox", "chrome"];

  try {
    const { username, from } = await authFromBrowser(sources);
    console.log(
      `saved LeetCode session for "${username}" (from ${from}). ` +
        `Run \`leet import --adapter leetcode\` to sync your solved problems.`,
    );
  } catch (err) {
    throw new UserError(err instanceof Error ? err.message : String(err));
  }
}

async function cmdTui(p: Parsed): Promise<void> {
  const name = p.positionals[0];
  // With no list, launch into the first list; the picker (L) switches from there.
  await runTui(name ? await loadList(name) : undefined);
}

async function cmdRandom(p: Parsed): Promise<void> {
  const name = p.positionals[0];
  let pool: Problem[];
  if (name) {
    pool = (await loadList(name)).problems;
  } else {
    pool = [];
    for (const n of await availableLists()) pool.push(...(await loadList(n)).problems);
  }
  const completed = await loadCompleted();
  const chosen = pickRandom(filterProblems(pool, filtersFrom(p.values, completed)));
  if (!chosen) throw new UserError("no problems match those filters");
  if (p.values.json) console.log(JSON.stringify(chosen, null, 2));
  else console.log(renderProblem(chosen, undefined, completed.has(chosen.id)));
}

async function cmdShow(p: Parsed, live: boolean): Promise<void> {
  const key = p.positionals[0];
  if (!key) throw new UserError("usage: leet show <id|slug> [--live]");
  const local = await findProblemAnywhere(key);
  const completed = await loadCompleted();
  if (live) {
    const slug = local?.slug ?? key;
    const remote = await fetchProblem(slug, { withContent: true });
    const merged: Problem = local ?? {
      id: remote.id,
      title: remote.title,
      slug: remote.slug,
      url: `https://leetcode.com/problems/${remote.slug}/`,
      acceptance: remote.acceptance,
      difficulty: remote.difficulty,
    };
    console.log(
      renderProblem(
        { ...merged, acceptance: remote.acceptance, difficulty: remote.difficulty },
        remote.contentHtml,
        completed.has(merged.id),
      ),
    );
    return;
  }
  if (!local) throw new UserError(`"${key}" not found in bundled lists (try --live)`);
  if (p.values.json) console.log(JSON.stringify(local, null, 2));
  else console.log(renderProblem(local, undefined, completed.has(local.id)));
}

/**
 * `leet solve <id|slug>` — scaffold a C++ solution file from LeetCode's starter
 * code, print the problem statement, and embed a runnable test harness built
 * from the example cases. `--quiet` skips printing the statement.
 */
async function cmdSolve(p: Parsed): Promise<void> {
  const key = p.positionals[0];
  if (!key) throw new UserError("usage: leet solve <id|slug> [--force] [--quiet] [--fresh]");
  const local = await findProblemAnywhere(key);
  const slug = local?.slug ?? key;
  const dir = resolveSolutionsDir(p.values.dir as string | undefined, await loadConfig());
  const fresh = Boolean(p.values.fresh);

  // Cache-first: a prior live fetch (or prefetch) already packaged this file.
  const cached = fresh ? null : await getCached(slug);
  let content: string;
  let id: number;
  let statement: { title: string; difficulty: string; html: string } | null = null;

  if (cached !== null) {
    content = cached;
    // Recover id from the cached header comment: "// <id>. <title> [..]".
    const m = cached.match(/^\/\/\s*(\d+)\./);
    id = m ? Number(m[1]) : (local?.id ?? 0);
  } else {
    const remote = await fetchProblem(slug, { withSnippets: true, withContent: true });
    id = remote.id;
    content = scaffoldContent({
      id: remote.id,
      title: remote.title,
      slug: remote.slug,
      difficulty: remote.difficulty,
      url: `https://leetcode.com/problems/${remote.slug}/`,
      snippets: remote.snippets ?? [],
      metaData: remote.metaData,
      exampleTestcases: remote.exampleTestcases,
      contentHtml: remote.contentHtml,
    });
    await putCached(slug, content); // populate cache for next time
    if (remote.contentHtml) {
      statement = { title: remote.title, difficulty: remote.difficulty, html: remote.contentHtml };
    }
  }

  const path = `${dir}/${scaffoldFilename(id, slug)}`;
  if (!p.values.force && (await Bun.file(path).exists())) {
    throw new UserError(`${path} already exists (pass --force to overwrite)`);
  }
  await Bun.write(path, content);

  // -o hands off to the editor, so skip dumping the statement first.
  if (!p.values.quiet && !p.values.open) {
    if (statement) {
      console.log(`\n${id}. ${statement.title} [${statement.difficulty}]`);
      console.log(`https://leetcode.com/problems/${slug}/`);
      console.log("");
      console.log(htmlToText(statement.html));
      console.log("");
    } else if (cached !== null) {
      // Served from cache — the description lives in the file's header comment.
      console.log(`\n(served from cache; description is in ${scaffoldFilename(id, slug)})\n`);
    }
  }
  const hasHarness = content.includes("int main()");
  const src = cached !== null ? "cached" : "fetched";
  console.log(`wrote ${path}${hasHarness ? " (with test harness)" : ""} [${src}]`);

  if (p.values.open) await openInEditor(path);
}

/**
 * `leet test <id|slug>` — compile a scaffolded solution and run its embedded
 * harness. Resolves the file in <dir> (default ./solutions); if it isn't there,
 * scaffolds it first (cache-first, like `solve`). The C++ compiler is $CXX or
 * `c++`; the binary's output (the harness pass/fail) is streamed through.
 */
async function cmdTest(p: Parsed): Promise<void> {
  const key = p.positionals[0];
  if (!key) throw new UserError("usage: leet test <id|slug> [--dir <dir>]");
  const local = await findProblemAnywhere(key);
  const slug = local?.slug ?? key;
  const config = await loadConfig();
  const dir = resolveSolutionsDir(p.values.dir as string | undefined, config);

  // Locate the scaffolded .cpp; scaffold it (from cache, else live) if missing.
  let path: string | null = null;
  const glob = new Bun.Glob(`*-${slug}.cpp`);
  for await (const f of glob.scan(dir)) {
    path = `${dir}/${f}`;
    break;
  }
  if (path === null) {
    const cached = await getCached(slug);
    let content: string;
    let id: number;
    if (cached !== null) {
      content = cached;
      id = Number(cached.match(/^\/\/\s*(\d+)\./)?.[1] ?? local?.id ?? 0);
    } else {
      const r = await fetchProblem(slug, { withSnippets: true, withContent: true });
      id = r.id;
      content = scaffoldContent({
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
      await putCached(slug, content);
    }
    path = `${dir}/${scaffoldFilename(id, slug)}`;
    await Bun.write(path, content);
    console.error(`scaffolded ${path}`);
  }

  if (!(await Bun.file(path).text()).includes("int main()")) {
    throw new UserError(`${path} has no test harness (unsupported signature) — nothing to run`);
  }

  // Compile.
  const cxx = resolveCxx(config);
  const bin = `${path.replace(/\.cpp$/, "")}.out`;
  console.error(`compiling ${path}…`);
  const compile = Bun.spawn([cxx, "-std=c++17", "-O2", path, "-o", bin], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await compile.exited) !== 0) {
    throw new UserError("compilation failed (fill in the Solution body, then retry)");
  }

  // Run the harness, streaming its output; exit non-zero if any case failed.
  const proc = Bun.spawn([bin], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new UserError(`test binary exited ${code}`);
}

/**
 * `leet push` — submit your solutions to LeetCode so they're marked Accepted.
 * Sources a C++ solution per problem (default: the neetcode-gh community repo;
 * or --source dir to read <id>-<slug>.cpp from your solutions dir), submits it,
 * and reports the judge verdict.
 *
 * This WRITES to your LeetCode account, so it defaults to a dry run: it prints
 * the plan and does nothing until you pass --yes. Submissions are rate-limited.
 */
async function cmdPush(p: Parsed): Promise<void> {
  const auth = resolveLeetCodeAuth(await loadConfig());
  if (!auth) throw new UserError("no LeetCode session — run `leet auth` first.");
  if (!auth.csrf) {
    throw new UserError("no CSRF token saved — re-run `leet auth` (submitting requires it).");
  }

  const sourceKind = (p.values.source as string | undefined) ?? "neetcode";
  const dryRun = Boolean(p.values["dry-run"]) || !p.values.yes;
  const limit = p.values.limit ? Math.max(1, Number(p.values.limit)) : Infinity;
  const config = await loadConfig();
  const dir = resolveSolutionsDir(p.values.dir as string | undefined, config);

  // `push` gets problems Accepted *on LeetCode*, so the "already solved" filter
  // must be your LeetCode account — not local tracking, which also counts
  // NeetCode-only solves that were never submitted (the very ones to push).
  // Fetch the live solved set once and skip those; --all re-submits everything.
  const includeSolved = Boolean(p.values.all);
  let remoteSolved = new Set<string>();
  if (!includeSolved) {
    console.error("checking which problems you've already solved on LeetCode…");
    remoteSolved = new Set(await fetchSolvedSlugs(auth));
  }

  const completed = await loadCompleted();
  const seen = new Set<string>();
  const candidates: Problem[] = [];
  for (const name of await availableLists()) {
    for (const pr of (await loadList(name)).problems) {
      if (seen.has(pr.slug)) continue;
      seen.add(pr.slug);
      if (remoteSolved.has(pr.slug)) continue; // already Accepted on LeetCode
      candidates.push(pr);
    }
  }

  // Resolve a C++ solution for each candidate from the chosen source.
  const getSolution = async (pr: Problem): Promise<string | null> => {
    if (sourceKind === "dir") {
      const path = `${dir}/${scaffoldFilename(pr.id, pr.slug)}`;
      const f = Bun.file(path);
      return (await f.exists()) ? f.text() : null;
    }
    const nc = await fetchNeetcodeCpp(pr.slug);
    return nc?.code ?? null;
  };

  // Build the work list (problems we have a solution for), capped. Premium
  // problems can't be submitted without a subscription — LeetCode serves an
  // HTML paywall, not the judge — so skip them up front with an honest note
  // rather than burning retries on a "throttle" that never clears.
  console.error(`resolving solutions from ${sourceKind}…`);
  const work: { pr: Problem; code: string }[] = [];
  let premiumSkipped = 0;
  for (const pr of candidates) {
    if (work.length >= limit) break;
    const code = await getSolution(pr);
    if (!code) continue;
    try {
      const meta = await fetchProblem(pr.slug);
      if (meta.isPaidOnly) {
        premiumSkipped++;
        continue;
      }
    } catch {
      // If the metadata check fails, fall through and let the submit attempt decide.
    }
    work.push({ pr, code });
  }
  if (premiumSkipped > 0) {
    console.error(`skipped ${premiumSkipped} Premium-only problem(s) — can't submit without LeetCode Premium.`);
  }

  if (work.length === 0) {
    console.error(`no solutions found from "${sourceKind}" for the candidate problems.`);
    return;
  }

  console.log(`${work.length} problem(s) have a solution to submit:`);
  for (const { pr } of work.slice(0, 30)) console.log(`  ${pr.id}  ${pr.title}`);
  if (work.length > 30) console.log(`  … and ${work.length - 30} more`);

  if (dryRun) {
    console.error(
      `\n(dry run — nothing submitted. This will make ${work.length} real submission(s) to your ` +
        `LeetCode account. Re-run with --yes to submit.)`,
    );
    return;
  }

  // Real submissions: one at a time, conservatively paced, with per-submit 429
  // backoff+retry inside submitSolution. `--delay <sec>` overrides the gap.
  const delayMs = p.values.delay ? Math.max(0, Number(p.values.delay) * 1000) : 12_000;
  let accepted = 0;
  let failed = 0;
  for (let i = 0; i < work.length; i++) {
    const { pr, code } = work[i]!;
    process.stderr.write(`[${i + 1}/${work.length}] submitting ${pr.id} ${pr.title}… `);
    try {
      const v = await submitSolution(auth, pr.slug, code, {
        lang: "cpp",
        onRetry: (attempt, waitMs) =>
          process.stderr.write(`(rate-limited; backing off ${Math.round(waitMs / 1000)}s, retry ${attempt})… `),
      });
      if (v.accepted) {
        accepted++;
        completed.add(pr.id);
        await saveCompleted(completed); // persist incrementally so a stop keeps progress
        console.error(`Accepted (${v.passed ?? "?"}/${v.total ?? "?"})`);
      } else {
        failed++;
        console.error(`${v.statusMsg}${v.detail ? ` — ${v.detail.split("\n")[0]}` : ""}`);
      }
    } catch (err) {
      failed++;
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Space submissions well apart to stay under LeetCode's limiter.
    if (i < work.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  console.error(`\ndone: ${accepted} accepted, ${failed} not accepted. ${completed.size} done total.`);
}

/** Run a command, throwing with stderr on non-zero exit. */
async function run(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new UserError(`\`${cmd.join(" ")}\` failed: ${err.trim() || out.trim()}`);
  return out;
}

/**
 * `leet sync <owner/repo>` — package every problem across the bundled lists
 * (descriptions, C++ stub+harness, test cases) into a private GitHub repo.
 * Clones the repo, skips problems already present, fetches the rest with
 * staggered random delays, then commits and pushes.
 */
async function cmdSync(p: Parsed): Promise<void> {
  const repo = p.positionals[0];
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new UserError(
      "usage: leet sync <owner/repo> [list ...] [--dry-run] [--no-push] [--force]",
    );
  }
  const listArgs = p.positionals.slice(1);
  const listNames = listArgs.length > 0 ? listArgs : undefined;
  const dryRun = Boolean(p.values["dry-run"]);
  const force = Boolean(p.values.force); // regenerate even if already present

  const targets = await collectTargets(listNames);
  console.error(
    `sync: ${targets.length} unique problems from ${listNames ? listNames.join(", ") : "all lists"}` +
      (dryRun ? " (dry run)" : ` -> ${repo}`),
  );
  if (dryRun) {
    for (const t of targets) console.log(`${t.slug}  [${t.lists.join(", ")}]`);
    return;
  }

  // Clone the target repo into a temp working dir via gh (uses your auth).
  const workdir = `${await run(["mktemp", "-d"])}`.trim();
  const clone = `${workdir}/repo`;
  console.error(`cloning ${repo}…`);
  await run(["gh", "repo", "clone", repo, clone, "--", "--depth", "1"]);

  const existsInRepo = async (slug: string): Promise<boolean> => {
    const glob = new Bun.Glob(`*-${slug}.cpp`);
    for await (const _ of glob.scan(clone)) return true;
    return false;
  };
  const write = async (filename: string, content: string): Promise<void> => {
    await Bun.write(`${clone}/${filename}`, content);
  };

  const result = await syncTargets(targets, {
    skipExisting: !force,
    minDelayMs: 0,
    maxDelayMs: 2000,
    exists: existsInRepo,
    write,
    onProgress: (done, total, slug) => {
      if (done % 10 === 0 || done === total) console.error(`  [${done}/${total}] ${slug}`);
    },
    onMiss: (m) => {
      const tag = m.recoveredFromNeetcode ? "recovered (neetcode)" : `missing (${m.reason})`;
      console.error(`  ${tag}: ${m.slug}`);
    },
    onError: (slug, err) =>
      console.error(`  failed ${slug}: ${err instanceof Error ? err.message : String(err)}`),
  });

  console.error(
    `fetched ${result.written.length} new, recovered ${result.recovered.length} via neetcode, ` +
      `skipped ${result.skipped.length}, missing ${result.missed.length}`,
  );

  // Keep a README explaining how to run a problem's tests, plus a manifest of gaps.
  await Bun.write(`${clone}/README.md`, REPO_README);
  await Bun.write(`${clone}/MISSING.md`, missingManifest(result.missed));

  const changed = result.written.length + result.recovered.length + result.missed.length;
  if (changed === 0 && !force) {
    console.error("nothing new to commit.");
    return;
  }

  await run(["git", "add", "-A"], clone);
  const verb = force ? "regenerate" : "add";
  const msg =
    `sync: ${verb} ${result.written.length} problems` +
    (result.recovered.length ? `, ${result.recovered.length} via neetcode` : "") +
    (result.missed.length ? `, ${result.missed.length} missing` : "") +
    " (leet-cli)";
  // Nothing may have actually changed on a --force re-run; tolerate an empty commit.
  await run(["git", "commit", "--allow-empty", "-m", msg], clone);
  if (!p.values["no-push"]) {
    console.error("pushing…");
    await run(["git", "push"], clone);
    console.error(`pushed to ${repo}.`);
  } else {
    console.error(`committed locally in ${clone} (--no-push).`);
  }
}

async function cmdOpen(p: Parsed): Promise<void> {
  const key = p.positionals[0];
  if (!key) throw new UserError("usage: leet open <id|slug> [list]");
  const listName = p.positionals[1];
  const found = listName
    ? findProblem((await loadList(listName)).problems, key)
    : await findProblemAnywhere(key);
  if (!found) throw new UserError(`"${key}" not found`);
  console.log(`opening ${found.url}`);
  await openUrl(found.url);
}

/** `leet done` with no args lists completed problems; with keys, marks them. */
async function cmdDone(p: Parsed): Promise<void> {
  const completed = await loadCompleted();

  if (p.positionals.length === 0) {
    // List everything marked done, resolving ids back to problems for display.
    const byId = new Map<number, Problem>();
    for (const name of await availableLists()) {
      for (const pr of (await loadList(name)).problems) {
        if (completed.has(pr.id) && !byId.has(pr.id)) byId.set(pr.id, pr);
      }
    }
    const known = [...byId.values()].sort((a, b) => a.id - b.id);
    const orphans = [...completed].filter((id) => !byId.has(id)).sort((a, b) => a - b);
    if (p.values.json) {
      console.log(JSON.stringify({ completed: known, orphanIds: orphans }, null, 2));
      return;
    }
    if (completed.size === 0) {
      console.log("no problems marked done yet — try `leet done <id|slug>`");
      return;
    }
    console.log(renderTable(known, completed));
    if (orphans.length > 0) {
      console.error(`(${orphans.length} completed id(s) not in any bundled list: ${orphans.join(", ")})`);
    }
    return;
  }

  await setDone(p.positionals, completed, true);
}

async function cmdUndone(p: Parsed): Promise<void> {
  if (p.positionals.length === 0) throw new UserError("usage: leet undone <id|slug ...>");
  await setDone(p.positionals, await loadCompleted(), false);
}

/** Resolve keys to problem ids and flip their completion state. */
async function setDone(keys: string[], completed: Set<number>, done: boolean): Promise<void> {
  let changed = 0;
  for (const key of keys) {
    const found = await findProblemAnywhere(key);
    if (!found) {
      console.error(`  skipped "${key}": not found in bundled lists`);
      continue;
    }
    const already = completed.has(found.id);
    if (done && !already) {
      completed.add(found.id);
      changed++;
      console.log(`  ✓ ${found.id}. ${found.title}`);
    } else if (!done && already) {
      completed.delete(found.id);
      changed++;
      console.log(`  ✗ ${found.id}. ${found.title}`);
    } else {
      console.log(`  · ${found.id}. ${found.title} (already ${done ? "done" : "not done"})`);
    }
  }
  if (changed > 0) await saveCompleted(completed);
  console.error(`${changed} problem(s) ${done ? "marked done" : "unmarked"}, ${completed.size} done total.`);
}

async function cmdImport(p: Parsed): Promise<void> {
  const adapter = (p.values.adapter as string | undefined) ?? "neetcode";
  const source = p.positionals[0] ?? "";
  const dryRun = Boolean(p.values["dry-run"]);

  // The leetcode adapter needs no source (it fetches from the API) but does need
  // a session; every other adapter needs a source path/repo.
  let auth: { session: string; csrf?: string } | undefined;
  if (adapter === "leetcode") {
    const resolved = resolveLeetCodeAuth(await loadConfig());
    if (!resolved) {
      throw new UserError(
        "leetcode import needs your session cookie. Set it with:\n" +
          "  export LEETCODE_SESSION=<cookie value from your browser>\n" +
          "(optionally LEETCODE_CSRF), or add \"leetcodeSession\" to config.json. " +
          "Find it in your browser devtools → Application → Cookies → leetcode.com.",
      );
    }
    auth = resolved;
  } else if (!source) {
    throw new UserError(
      `usage: leet import <path|owner/repo|url> [--adapter <${adapterNames().join("|")}>] [--ref <ref>] [--dry-run]`,
    );
  }

  if (adapter === "leetcode") console.error("fetching your solved problems from LeetCode…");
  const result = await importSource(source, {
    adapter,
    ref: p.values.ref as string | undefined,
    auth,
    onProgress: (fetched, total) => {
      if (fetched % 500 === 0 || fetched === total) console.error(`  scanned ${fetched}/${total}`);
    },
  });

  const completed = await loadCompleted();
  const newIds = [...result.matchedIds].filter((id) => !completed.has(id));

  if (p.values.json) {
    console.log(
      JSON.stringify(
        {
          source,
          adapter,
          dryRun,
          totalSolved: result.totalSolved,
          matched: result.matched.length,
          newlyMarked: newIds.length,
          alreadyDone: result.matched.length - newIds.length,
          unmatched: result.unmatched,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Show the problems that would be newly marked.
  const newProblems = result.matched.filter((pr) => newIds.includes(pr.id));
  if (newProblems.length > 0) console.log(renderTable(newProblems, result.matchedIds));

  if (!dryRun && newIds.length > 0) {
    for (const id of newIds) completed.add(id);
    await saveCompleted(completed);
  }

  const verb = dryRun ? "would mark" : "marked";
  console.error(
    `\n${result.matched.length} of ${result.totalSolved} solved problems are in bundled lists; ` +
      `${verb} ${newIds.length} new, ${result.matched.length - newIds.length} already done. ` +
      `${result.unmatched.length} not in any bundled list.` +
      (dryRun ? "\n(dry run — nothing saved; re-run without --dry-run to apply)" : ` ${completed.size} done total.`),
  );
}

async function cmdRefresh(p: Parsed): Promise<void> {
  const all = Boolean(p.values.all);
  const names = all ? await availableLists() : p.positionals.slice(0, 1);
  if (names.length === 0) throw new UserError("usage: leet refresh <list|--all>");

  for (const name of names) {
    const list = await loadList(name);
    console.error(`refreshing ${name} (${list.problems.length} problems)…`);
    let failed = 0;
    const live = await fetchProblems(
      list.problems.map((pr) => pr.slug),
      { onError: () => failed++ },
    );
    let updated = 0;
    for (const pr of list.problems) {
      const l = live.get(pr.slug);
      if (!l) continue;
      if (pr.acceptance !== l.acceptance || pr.difficulty !== l.difficulty) updated++;
      pr.acceptance = l.acceptance;
      pr.difficulty = l.difficulty;
    }
    await saveList(list);
    console.error(`  ${name}: ${updated} updated, ${failed} failed, saved.`);
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case undefined:
      // Bare `leet` drops into the interactive TUI; if there's no terminal
      // (piped/redirected), fall back to printing help. The TUI suggests
      // pre-caching on first run rather than downloading silently.
      if (process.stdin.isTTY && process.stdout.isTTY) {
        await cmdTui(parse(rest));
      } else {
        console.log(HELP);
      }
      return 0;
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return 0;
    case "version":
    case "-v":
    case "--version":
      console.log(VERSION);
      return 0;
    case "lists":
      await cmdLists();
      return 0;
    case "ls":
      await cmdLs(parse(rest));
      return 0;
    case "tui":
      await cmdTui(parse(rest));
      return 0;
    case "random":
      await cmdRandom(parse(rest));
      return 0;
    case "show": {
      const parsed = parse(rest, { live: { type: "boolean" } });
      await cmdShow(parsed, Boolean(parsed.values.live));
      return 0;
    }
    case "solve":
      await cmdSolve(
        parse(rest, {
          force: { type: "boolean" },
          dir: { type: "string" },
          quiet: { type: "boolean" },
          fresh: { type: "boolean" },
          open: { type: "boolean", short: "o" },
        }),
      );
      return 0;
    case "test":
      await cmdTest(parse(rest, { dir: { type: "string" } }));
      return 0;
    case "push":
      await cmdPush(
        parse(rest, {
          source: { type: "string" }, // "neetcode" (default) or "dir"
          dir: { type: "string" },
          "dry-run": { type: "boolean" },
          yes: { type: "boolean", short: "y" },
          limit: { type: "string", short: "n" },
          delay: { type: "string" }, // seconds between submissions (default 12)
          all: { type: "boolean" }, // re-submit even problems already Accepted on LeetCode
        }),
      );
      return 0;
    case "sync":
      await cmdSync(
        parse(rest, {
          "dry-run": { type: "boolean" },
          "no-push": { type: "boolean" },
          force: { type: "boolean" },
        }),
      );
      return 0;
    case "open":
      await cmdOpen(parse(rest, { live: { type: "boolean" } }));
      return 0;
    case "done":
      await cmdDone(parse(rest));
      return 0;
    case "undone":
      await cmdUndone(parse(rest));
      return 0;
    case "import":
      await cmdImport(
        parse(rest, {
          adapter: { type: "string" },
          ref: { type: "string" },
          "dry-run": { type: "boolean" },
          json: { type: "boolean" },
        }),
      );
      return 0;
    case "refresh":
      await cmdRefresh(parse(rest, { all: { type: "boolean" } }));
      return 0;
    case "config":
      await cmdConfig(parse(rest, { unset: { type: "boolean" } }));
      return 0;
    case "setup":
      await cmdSetup(parse(rest, { list: { type: "string" } }));
      return 0;
    case "auth":
      await cmdAuth(
        parse(rest, {
          "from-chrome": { type: "boolean" },
          "from-firefox": { type: "boolean" },
        }),
      );
      return 0;
    default:
      throw new UserError(`unknown command "${command}" (run \`leet help\`)`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof UserError) {
      console.error(`error: ${err.message}`);
    } else {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  });
