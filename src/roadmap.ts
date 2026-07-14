/**
 * The NeetCode roadmap: the branching prerequisite structure between the 18
 * patterns (neetcode.io/roadmap). Edit `ROADMAP_EDGES` to change the graph —
 * everything (the tree view, ordering, counts) derives from it, so adding or
 * re-parenting a pattern is a one-line change.
 *
 * The graph is a DAG (a pattern can have several prerequisites, e.g. Advanced
 * Graphs follows both Graphs and Heap). The text view renders it as an indented
 * tree via a stable DFS from the roots, so a node with multiple parents appears
 * under its first-visited parent (with a `↗` marker noting the shared edge).
 */

/** A pattern and the patterns it unlocks (its children in the roadmap). */
export type RoadmapEdges = ReadonlyArray<readonly [string, readonly string[]]>;

/**
 * Canonical NeetCode roadmap edges (parent → children). This mirrors the public
 * roadmap graph, which is stable. Change a line here to reshape the view.
 */
export const ROADMAP_EDGES: RoadmapEdges = [
  ["Arrays & Hashing", ["Two Pointers", "Stack"]],
  ["Two Pointers", ["Binary Search", "Sliding Window", "Linked List"]],
  ["Stack", []],
  ["Binary Search", ["Trees"]],
  ["Sliding Window", []],
  ["Linked List", ["Trees"]],
  ["Trees", ["Tries", "Backtracking", "Heap / Priority Queue"]],
  ["Tries", []],
  ["Heap / Priority Queue", ["Intervals", "Greedy", "Advanced Graphs"]],
  ["Backtracking", ["Graphs", "1-D Dynamic Programming"]],
  ["Graphs", ["Advanced Graphs", "2-D Dynamic Programming"]],
  ["Advanced Graphs", []],
  ["1-D Dynamic Programming", ["2-D Dynamic Programming", "Bit Manipulation"]],
  ["2-D Dynamic Programming", []],
  ["Greedy", []],
  ["Intervals", []],
  ["Math & Geometry", []],
  ["Bit Manipulation", ["Math & Geometry"]],
];

const CHILDREN = new Map(ROADMAP_EDGES.map(([p, c]) => [p, [...c]]));

/** All patterns that appear as someone's child (i.e. have a prerequisite). */
function nonRoots(): Set<string> {
  const s = new Set<string>();
  for (const [, children] of ROADMAP_EDGES) for (const c of children) s.add(c);
  return s;
}

/** Roots of the DAG (no prerequisites), in declaration order. */
export function roadmapRoots(): string[] {
  const child = nonRoots();
  return ROADMAP_EDGES.map(([p]) => p).filter((p) => !child.has(p));
}

/** One rendered tree row: a pattern, its depth, and whether it's a re-visit. */
export interface RoadmapRow {
  pattern: string;
  depth: number;
  /** True when this pattern was already shown under another parent (shared prereq). */
  repeat: boolean;
}

/**
 * Flatten the DAG into indented tree rows via a stable DFS from the roots. A
 * pattern with multiple parents is expanded once (at first visit) and shown as
 * a leaf `repeat` row under any later parent, so the tree stays finite and each
 * pattern's problems are only attributed once.
 */
export function roadmapRows(): RoadmapRow[] {
  const rows: RoadmapRow[] = [];
  const expanded = new Set<string>();
  const visit = (pattern: string, depth: number): void => {
    const repeat = expanded.has(pattern);
    rows.push({ pattern, depth, repeat });
    if (repeat) return;
    expanded.add(pattern);
    for (const child of CHILDREN.get(pattern) ?? []) visit(child, depth + 1);
  };
  for (const root of roadmapRoots()) visit(root, 0);
  return rows;
}

/** Every pattern named in the roadmap (declaration order). */
export function roadmapPatterns(): string[] {
  return ROADMAP_EDGES.map(([p]) => p);
}
