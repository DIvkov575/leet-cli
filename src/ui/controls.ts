/**
 * Pure control-cycle helpers for the menu-bar toggles (done filter, difficulty,
 * sort). Each maps a current value to the next in its cycle. No state, no I/O.
 */
import type { Difficulty } from "../types.ts";
import type { SortKey } from "../lib.ts";

export type DoneFilter = "all" | "todo" | "done";

/** Cycle the done filter: all → todo → done → all. */
export function cycleDoneFilter(cur: DoneFilter): DoneFilter {
  return cur === "all" ? "todo" : cur === "todo" ? "done" : "all";
}

/** Cycle difficulty: undefined → Easy → Medium → Hard → undefined. */
export function cycleDifficulty(cur: Difficulty | undefined): Difficulty | undefined {
  const order: (Difficulty | undefined)[] = [undefined, "Easy", "Medium", "Hard"];
  return order[(order.indexOf(cur) + 1) % order.length];
}

/**
 * Cycle sort key + direction together, so a single action steps through every
 * ordering: id↑ → id↓ → acc↑ → acc↓ → difficulty↑ → … → title↓ → id↑.
 */
export function cycleSortState(key: SortKey, desc: boolean): { key: SortKey; desc: boolean } {
  const keys: SortKey[] = ["id", "acc", "difficulty", "title"];
  const seq = keys.indexOf(key) * 2 + (desc ? 1 : 0);
  const next = (seq + 1) % (keys.length * 2);
  return { key: keys[Math.floor(next / 2)]!, desc: next % 2 === 1 };
}

/**
 * The short shell command shown in the preview to scaffold + open a problem.
 * Slug-based so it never depends on the numeric id being known.
 */
export function solveCommand(_id: number, slug: string): string {
  return `leet solve ${slug} -o`;
}
