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
import { renderProblem, renderTable } from "./render.ts";

const HELP = `leet — browse bundled LeetCode company lists from the terminal

Usage:
  leet lists                       List the bundled problem lists
  leet ls <list> [filters]         Print a list as a table
  leet show <id|slug> [--live]     Show one problem (--live fetches the statement)
  leet open <id|slug> [list]       Open a problem in the browser
  leet random [list] [filters]     Print one random problem
  leet refresh <list|--all>        Refresh acceptance/difficulty from LeetCode

Filters (for ls / random):
  --difficulty, -d  easy|medium|hard
  --min-acc <n>     minimum acceptance %        --max-acc <n>  maximum acceptance %
  --search, -s <q>  title substring match
  --sort <key>      id|acc|difficulty|title (default id)   --desc  reverse order
  --limit, -n <n>   cap the number of rows
  --json            emit JSON instead of a table

Examples:
  leet ls nvidia -d hard --sort acc
  leet ls uber --search tree --limit 20
  leet random uber -d medium
  leet show 42 --live
  leet refresh nvidia`;

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

function filtersFrom(values: Parsed["values"]): FilterOptions {
  return {
    difficulty: parseDifficulty(values.difficulty as string | undefined),
    minAcceptance: num(values["min-acc"], "--min-acc"),
    maxAcceptance: num(values["max-acc"], "--max-acc"),
    search: values.search as string | undefined,
  };
}

function applyView(problems: Problem[], values: Parsed["values"]): Problem[] {
  let out = filterProblems(problems, filtersFrom(values));
  out = sortProblems(out, parseSort(values.sort as string | undefined), Boolean(values.desc));
  const limit = num(values.limit, "--limit");
  if (limit !== undefined) out = out.slice(0, limit);
  return out;
}

function output(problems: Problem[], values: Parsed["values"]): void {
  if (values.json) {
    console.log(JSON.stringify(problems, null, 2));
  } else {
    console.log(renderTable(problems));
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
  output(applyView(list.problems, p.values), p.values);
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
  const chosen = pickRandom(filterProblems(pool, filtersFrom(p.values)));
  if (!chosen) throw new UserError("no problems match those filters");
  if (p.values.json) console.log(JSON.stringify(chosen, null, 2));
  else console.log(renderProblem(chosen));
}

async function cmdShow(p: Parsed, live: boolean): Promise<void> {
  const key = p.positionals[0];
  if (!key) throw new UserError("usage: leet show <id|slug> [--live]");
  const local = await findProblemAnywhere(key);
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
    console.log(renderProblem({ ...merged, acceptance: remote.acceptance, difficulty: remote.difficulty }, remote.contentHtml));
    return;
  }
  if (!local) throw new UserError(`"${key}" not found in bundled lists (try --live)`);
  if (p.values.json) console.log(JSON.stringify(local, null, 2));
  else console.log(renderProblem(local));
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
    case "random":
      await cmdRandom(parse(rest));
      return 0;
    case "show": {
      const parsed = parse(rest, { live: { type: "boolean" } });
      await cmdShow(parsed, Boolean(parsed.values.live));
      return 0;
    }
    case "open":
      await cmdOpen(parse(rest, { live: { type: "boolean" } }));
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
