import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Difficulty, Problem, ProblemList } from "./types.ts";

export * from "./types.ts";
export { slugify, problemUrl, parseRawList } from "./parse.ts";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export interface FilterOptions {
  difficulty?: Difficulty;
  /** Minimum acceptance rate (inclusive). Problems with null acceptance are excluded. */
  minAcceptance?: number;
  /** Maximum acceptance rate (inclusive). Problems with null acceptance are excluded. */
  maxAcceptance?: number;
  /** Case-insensitive substring match against the title. */
  search?: string;
}

export type SortKey = "id" | "acc" | "difficulty" | "title";

const DIFFICULTY_ORDER: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

/** List the machine names of every bundled list, sorted alphabetically. */
export async function availableLists(): Promise<string[]> {
  const files = await readdir(DATA_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

/** Load one bundled list by name. Throws if it does not exist. */
export async function loadList(name: string): Promise<ProblemList> {
  const path = join(DATA_DIR, `${name}.json`);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    const names = await availableLists();
    throw new Error(`No such list "${name}". Available: ${names.join(", ")}`);
  }
  return (await file.json()) as ProblemList;
}

/** Persist a list back to its bundled JSON file (used by `refresh`). */
export async function saveList(list: ProblemList): Promise<void> {
  const path = join(DATA_DIR, `${list.name}.json`);
  await Bun.write(path, JSON.stringify(list, null, 2) + "\n");
}

export function filterProblems(problems: Problem[], opts: FilterOptions = {}): Problem[] {
  const search = opts.search?.toLowerCase();
  return problems.filter((p) => {
    if (opts.difficulty && p.difficulty !== opts.difficulty) return false;
    if (opts.minAcceptance !== undefined) {
      if (p.acceptance === null || p.acceptance < opts.minAcceptance) return false;
    }
    if (opts.maxAcceptance !== undefined) {
      if (p.acceptance === null || p.acceptance > opts.maxAcceptance) return false;
    }
    if (search && !p.title.toLowerCase().includes(search)) return false;
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
