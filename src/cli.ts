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
import { htmlToText, renderProblem, renderTable } from "./render.ts";
import { loadCompleted, saveCompleted } from "./progress.ts";
import { importSource } from "./import.ts";
import { adapterNames } from "./adapters.ts";
import { runTui } from "./tui.ts";

const HELP = `leet — browse bundled LeetCode company lists from the terminal

Usage:
  leet                             Open the interactive browser (pick lists, filter, preview…)
  leet tui [list]                  Same, optionally starting on a specific list
  leet lists                       List the bundled problem lists
  leet ls <list> [filters]         Print a list as a table
  leet show <id|slug> [--live]     Show one problem (--live fetches the statement)
  leet solve <id|slug> [--force]   Scaffold a runnable C++ file (stub + test harness) and print the statement
  leet open <id|slug> [list]       Open a problem in the browser
  leet random [list] [filters]     Print one random problem
  leet done [id|slug ...]          Mark problems done, or list what's done
  leet undone <id|slug ...>        Unmark problems as done
  leet import <path|owner/repo>    Mark done from an external source (e.g. NeetCode sync)
  leet refresh <list|--all>        Refresh acceptance/difficulty from LeetCode

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
  leet import DIvkov575/neetcode-submissions-zkag82uy   # mark done from a GitHub sync
  leet import ~/code/neetcode --dry-run                 # preview from a local clone
  leet random uber -d medium
  leet show 42 --live
  leet solve two-sum              # write solutions/1-two-sum.cpp
  leet refresh nvidia

import options:
  --adapter <name>  source format (default neetcode)
  --ref <ref>       git ref/branch/sha for a GitHub source (default: default branch)
  --dry-run         report what would be marked without saving`;

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

async function cmdLists(): Promise<void> {
  const names = await availableLists();
  for (const name of names) {
    const list = await loadList(name);
    console.log(`${name.padEnd(16)} ${String(list.problems.length).padStart(4)}  ${list.title}`);
  }
}

async function cmdLs(p: Parsed): Promise<void> {
  const name = p.positionals[0];
  if (!name) throw new UserError("usage: leet ls <list> [filters]");
  const list = await loadList(name);
  const completed = await loadCompleted();
  output(applyView(list.problems, p.values, completed), p.values, completed);
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
  if (!key) throw new UserError("usage: leet solve <id|slug> [--force] [--quiet]");
  const local = await findProblemAnywhere(key);
  const slug = local?.slug ?? key;

  const remote = await fetchProblem(slug, { withSnippets: true, withContent: true });
  const dir = (p.values.dir as string | undefined) ?? "solutions";
  const path = `${dir}/${scaffoldFilename(remote.id, remote.slug)}`;

  if (!p.values.force && (await Bun.file(path).exists())) {
    throw new UserError(`${path} already exists (pass --force to overwrite)`);
  }

  const url = `https://leetcode.com/problems/${remote.slug}/`;
  const content = scaffoldContent({
    id: remote.id,
    title: remote.title,
    slug: remote.slug,
    difficulty: remote.difficulty,
    url,
    snippets: remote.snippets ?? [],
    metaData: remote.metaData,
    exampleTestcases: remote.exampleTestcases,
    contentHtml: remote.contentHtml,
  });
  await Bun.write(path, content);

  if (!p.values.quiet && remote.contentHtml) {
    console.log(`\n${remote.id}. ${remote.title} [${remote.difficulty}]`);
    console.log(url);
    console.log("");
    console.log(htmlToText(remote.contentHtml));
    console.log("");
  }
  const hasHarness = content.includes("int main()");
  console.log(`wrote ${path}${hasHarness ? " (with test harness)" : ""}`);
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
  const source = p.positionals[0];
  if (!source) {
    throw new UserError(
      `usage: leet import <path|owner/repo|url> [--adapter <${adapterNames().join("|")}>] [--ref <ref>] [--dry-run]`,
    );
  }
  const adapter = (p.values.adapter as string | undefined) ?? "neetcode";
  const dryRun = Boolean(p.values["dry-run"]);

  const result = await importSource(source, {
    adapter,
    ref: p.values.ref as string | undefined,
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
      // (piped/redirected), fall back to printing help.
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
        }),
      );
      return 0;
    case "refresh":
      await cmdRefresh(parse(rest, { all: { type: "boolean" } }));
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
