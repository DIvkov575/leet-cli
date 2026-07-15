/**
 * The NeetCode roadmap: the branching prerequisite structure between the 18
 * patterns (neetcode.io/roadmap). Edit `ROADMAP_EDGES` to change the graph —
 * everything (the tree view, ordering, counts) derives from it, so adding or
 * re-parenting a pattern is a one-line change.
 *
 * The graph is a DAG (a pattern can have several prerequisites, e.g. Advanced
 * Graphs follows both Graphs and Heap). The box view lays patterns out in rows
 * by longest-path level (`roadmapLevels`) so every prerequisite edge points
 * downward, and draws each pattern as a box with connectors to its children.
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

/** Immediate prerequisites (parents) of each pattern. */
function parents(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of roadmapPatterns()) m.set(p, []);
  for (const [parent, children] of ROADMAP_EDGES) {
    for (const c of children) m.get(c)!.push(parent);
  }
  return m;
}

/**
 * Longest-path level (row) of each pattern: 0 for roots, else 1 + the deepest
 * parent. This lays the DAG out top-to-bottom so every edge points downward.
 */
export function roadmapLevelOf(): Map<string, number> {
  const par = parents();
  const level = new Map<string, number>();
  const compute = (p: string): number => {
    const cached = level.get(p);
    if (cached !== undefined) return cached;
    const ps = par.get(p) ?? [];
    const lv = ps.length === 0 ? 0 : 1 + Math.max(...ps.map(compute));
    level.set(p, lv);
    return lv;
  };
  for (const p of roadmapPatterns()) compute(p);
  return level;
}

/**
 * The patterns grouped into rows by level, for the box-flowchart view. Within a
 * row, patterns keep declaration order (stable, readable layout).
 */
export function roadmapLevels(): string[][] {
  const level = roadmapLevelOf();
  const maxLevel = Math.max(...level.values());
  const rows: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const p of roadmapPatterns()) rows[level.get(p)!]!.push(p);
  return rows;
}

/** Immediate children of a pattern (what it unlocks). */
export function roadmapChildren(pattern: string): string[] {
  return CHILDREN.get(pattern) ?? [];
}

/**
 * Short labels for the box view, so a row of boxes fits an 80-col terminal.
 * Patterns not listed here use their full name (already short enough).
 */
const SHORT_LABELS: Record<string, string> = {
  "Arrays & Hashing": "Arrays/Hash",
  "Sliding Window": "Sliding Win",
  "Binary Search": "Bin. Search",
  "Heap / Priority Queue": "Heap / PQ",
  "Advanced Graphs": "Adv. Graphs",
  "1-D Dynamic Programming": "1-D DP",
  "2-D Dynamic Programming": "2-D DP",
  "Bit Manipulation": "Bit Manip.",
  "Math & Geometry": "Math/Geo",
};

/** A compact label for `pattern` suitable for a fixed-width box. */
export function roadmapShortLabel(pattern: string): string {
  return SHORT_LABELS[pattern] ?? pattern;
}

// ─── chart model (drives the NeetCode pattern DAG) ───────────────────────────

/**
 * One node in a roadmap chart. `id` is stable (the pattern name); `pattern` is
 * the NeetCode pattern the node filters to when selected. `kind` is retained
 * for forward-compatibility but is always "pattern" now that the roadmap draws
 * only the pattern DAG (LeetCode topics are surfaced in the tag picker instead).
 */
export interface ChartNode {
  id: string;
  label: string;
  level: number;
  kind: "pattern";
  pattern: string;
}

/** A laid-out chart: nodes grouped into level-rows, plus parent→child edges. */
export interface Chart {
  /** Rows of nodes, top level first. */
  rows: ChartNode[][];
  /** Edges as [parentId, childId], for drawing connectors. */
  edges: Array<[string, string]>;
}

/** The NeetCode chart: the 18-pattern DAG (one box per pattern). */
export function neetcodeChart(): Chart {
  const level = roadmapLevelOf();
  const rows = roadmapLevels().map((row) =>
    row.map(
      (p): ChartNode => ({
        id: p,
        label: roadmapShortLabel(p),
        level: level.get(p)!,
        kind: "pattern",
        pattern: p,
      }),
    ),
  );
  const edges: Array<[string, string]> = [];
  for (const [parent, children] of ROADMAP_EDGES) {
    for (const c of children) edges.push([parent, c]);
  }
  return { rows, edges };
}

/**
 * Grid navigation over a laid-out chart. Given the flat node list (row-major)
 * and the current index, move in `dir` and return the new index (clamped).
 */
export function chartMove(
  chart: Chart,
  cursor: number,
  dir: "up" | "down" | "left" | "right",
): number {
  const flat = chart.rows.flat();
  const cur = flat[cursor];
  if (!cur) return cursor;
  const rowIdx = chart.rows.findIndex((r) => r.includes(cur));
  const row = chart.rows[rowIdx]!;
  const col = row.indexOf(cur);
  const at = (n: ChartNode): number => flat.indexOf(n);
  if (dir === "left") return col > 0 ? at(row[col - 1]!) : cursor;
  if (dir === "right") return col < row.length - 1 ? at(row[col + 1]!) : cursor;
  const trow = chart.rows[dir === "up" ? rowIdx - 1 : rowIdx + 1];
  if (!trow || trow.length === 0) return cursor;
  return at(trow[Math.min(col, trow.length - 1)]!);
}

/**
 * Move the flat-index `cursor` (into `roadmapPatterns()`) in a grid direction,
 * matching the box layout: left/right step within a level; up/down jump to the
 * nearest box (by position-in-row) on the adjacent level. Returns the new flat
 * index (clamped; unchanged if there's no box that way).
 */
export function roadmapMove(cursor: number, dir: "up" | "down" | "left" | "right"): number {
  const flat = roadmapPatterns();
  const level = roadmapLevelOf();
  const levels = roadmapLevels();
  const cur = flat[cursor]!;
  const lv = level.get(cur)!;
  const row = levels[lv]!;
  const col = row.indexOf(cur);

  const at = (pattern: string): number => flat.indexOf(pattern);
  if (dir === "left") return col > 0 ? at(row[col - 1]!) : cursor;
  if (dir === "right") return col < row.length - 1 ? at(row[col + 1]!) : cursor;
  const target = dir === "up" ? lv - 1 : lv + 1;
  const trow = levels[target];
  if (!trow || trow.length === 0) return cursor;
  // Keep the same column position where possible; else the nearest.
  const idx = Math.min(col, trow.length - 1);
  return at(trow[idx]!);
}
