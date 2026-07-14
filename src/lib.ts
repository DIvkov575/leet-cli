import { readdir, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Difficulty, Problem, ProblemList } from "./types.ts";
import { EMBEDDED_LISTS } from "./lists.generated.ts";

export * from "./types.ts";
export { slugify, problemUrl, parseRawList } from "./parse.ts";

/**
 * Bundled lists are embedded in the binary (EMBEDDED_LISTS) so a compiled,
 * standalone `leet` works with no data/ directory on disk. Downloaded or
 * refreshed lists are written to a writable "lists" dir under the user data
 * dir; those shadow the embedded copies of the same name. This is what lets a
 * distributed binary pick up automatic problem-list downloads.
 */
function listsDir(): string {
  const base =
    process.env.LEET_DATA_DIR ??
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "leet-cli");
  return join(base, "lists");
}

/**
 * Machine name of the synthetic "All Problems" list: the de-duplicated union of
 * every real list. It's built on demand by `loadList("all")` rather than stored
 * on disk, so it never appears in `availableLists()` (the real, individually
 * excludable lists that sync/config/recommend operate on). `browsableLists()`
 * prepends it for the browsing UIs.
 */
export const ALL_LIST_NAME = "all";

export interface FilterOptions {
  difficulty?: Difficulty;
  /** Minimum acceptance rate (inclusive). Problems with null acceptance are excluded. */
  minAcceptance?: number;
  /** Maximum acceptance rate (inclusive). Problems with null acceptance are excluded. */
  maxAcceptance?: number;
  /** Case-insensitive substring match against the title. */
  search?: string;
  /** Set of completed problem ids; required for `done` filtering to apply. */
  completed?: Set<number>;
  /** true -> only completed, false -> only not-completed, undefined -> all. */
  done?: boolean;
  /**
   * Keep only problems whose NeetCode `pattern` is in this set. Empty/undefined
   * disables the filter. A problem with no `pattern` is excluded when set.
   */
  patterns?: string[];
}

export type SortKey = "id" | "acc" | "difficulty" | "title";

const DIFFICULTY_ORDER: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

/** Machine names of downloaded lists present on disk (may be empty). */
async function downloadedNames(): Promise<string[]> {
  try {
    return (await readdir(listsDir()))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return []; // dir doesn't exist yet
  }
}

/** List the machine names of every available list (embedded ∪ downloaded), sorted. */
export async function availableLists(): Promise<string[]> {
  const names = new Set<string>(Object.keys(EMBEDDED_LISTS));
  for (const n of await downloadedNames()) names.add(n);
  return [...names].sort();
}

/**
 * Names shown in the browsing UIs: the synthetic "all" union first, then every
 * real list. Distinct from `availableLists()`, which enumerates only the real,
 * individually-addressable lists (used by sync/config/refresh, where "all"
 * would be meaningless or would double-count).
 */
export async function browsableLists(): Promise<string[]> {
  return [ALL_LIST_NAME, ...(await availableLists())];
}

/**
 * De-duplicated union of every real list, as a synthetic ProblemList. A problem
 * that appears in several lists is kept once (first occurrence wins); problems
 * are ordered by id so the view is stable. Built in memory — never persisted.
 */
export async function loadAllProblems(): Promise<ProblemList> {
  const byId = new Map<number, Problem>();
  for (const name of await availableLists()) {
    for (const p of (await loadList(name)).problems) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  const problems = [...byId.values()].sort((a, b) => a.id - b.id);
  return { name: ALL_LIST_NAME, title: "All Problems", problems };
}

/**
 * Load one list by name. The synthetic "all" name yields the union of every
 * list. Otherwise a downloaded copy on disk shadows the embedded one (so
 * `refresh`/downloads take effect); failing that the embedded copy is used.
 */
export async function loadList(name: string): Promise<ProblemList> {
  if (name === ALL_LIST_NAME) return loadAllProblems();
  const file = Bun.file(join(listsDir(), `${name}.json`));
  if (await file.exists()) {
    return (await file.json()) as ProblemList;
  }
  const embedded = EMBEDDED_LISTS[name];
  if (embedded) return embedded;
  const names = await availableLists();
  throw new Error(`No such list "${name}". Available: ${names.join(", ")}`);
}

/**
 * Persist a list to the writable lists dir (used by `refresh` and automatic
 * downloads). This shadows any embedded list of the same name on next load.
 */
export async function saveList(list: ProblemList): Promise<void> {
  if (list.name === ALL_LIST_NAME) {
    throw new Error(`cannot save the synthetic "${ALL_LIST_NAME}" list`);
  }
  await mkdir(listsDir(), { recursive: true });
  const path = join(listsDir(), `${list.name}.json`);
  await Bun.write(path, JSON.stringify(list, null, 2) + "\n");
}

export function filterProblems(problems: Problem[], opts: FilterOptions = {}): Problem[] {
  const search = opts.search?.toLowerCase();
  const patternSet = opts.patterns && opts.patterns.length > 0 ? new Set(opts.patterns) : null;
  return problems.filter((p) => {
    if (patternSet && !(p.pattern && patternSet.has(p.pattern))) return false;
    if (opts.difficulty && p.difficulty !== opts.difficulty) return false;
    if (opts.minAcceptance !== undefined) {
      if (p.acceptance === null || p.acceptance < opts.minAcceptance) return false;
    }
    if (opts.maxAcceptance !== undefined) {
      if (p.acceptance === null || p.acceptance > opts.maxAcceptance) return false;
    }
    if (search && !p.title.toLowerCase().includes(search)) return false;
    if (opts.done !== undefined) {
      const isDone = opts.completed?.has(p.id) ?? false;
      if (isDone !== opts.done) return false;
    }
    return true;
  });
}

/** Return a sorted copy; does not mutate the input. */
export function sortProblems(problems: Problem[], key: SortKey, desc = false): Problem[] {
  const dir = desc ? -1 : 1;
  const cmp = (a: Problem, b: Problem): number => {
    switch (key) {
      case "id":
        return (a.id - b.id) * dir;
      case "acc":
        // Nulls always sort last regardless of direction.
        if (a.acceptance === null && b.acceptance === null) return 0;
        if (a.acceptance === null) return 1;
        if (b.acceptance === null) return -1;
        return (a.acceptance - b.acceptance) * dir;
      case "difficulty":
        return (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]) * dir;
      case "title":
        return a.title.localeCompare(b.title) * dir;
    }
  };
  return [...problems].sort(cmp);
}

/** Find a problem in a list by numeric id or exact slug. */
export function findProblem(problems: Problem[], idOrSlug: string): Problem | undefined {
  const asNum = Number(idOrSlug);
  if (Number.isInteger(asNum) && idOrSlug.trim() !== "") {
    return problems.find((p) => p.id === asNum);
  }
  const slug = idOrSlug.toLowerCase();
  return problems.find((p) => p.slug === slug);
}

/** Search every bundled list for a problem by id or slug. */
export async function findProblemAnywhere(idOrSlug: string): Promise<Problem | undefined> {
  for (const name of await availableLists()) {
    const list = await loadList(name);
    const found = findProblem(list.problems, idOrSlug);
    if (found) return found;
  }
  return undefined;
}

export function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}
