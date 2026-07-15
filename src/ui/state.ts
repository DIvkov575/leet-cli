/**
 * The TUI's state shape and its pure derived helpers (no rendering, no I/O
 * beyond `loadList` for switching lists). The runtime in `tui.ts` owns a single
 * `State` and mutates it through these; the renderers in `ui/render.ts` read it.
 */
import type { Difficulty, Problem, ProblemList } from "../types.ts";
import {
  filterProblems,
  loadList,
  sortProblems,
  ALL_LIST_NAME,
  type SortKey,
} from "../lib.ts";
import type { Recommendation } from "../recommend.ts";
import type { Config, ConfigKey, RoadmapChart, RoadmapSubset } from "../config.ts";
import type { DoneFilter } from "./controls.ts";
import { fuzzyRankProblems } from "../fuzzy.ts";

export interface PreviewState {
  slug: string | null;
  status: "idle" | "loading" | "loaded" | "error";
  /** Unwrapped statement text; wrapped to the panel width at render time. */
  text: string;
  scroll: number;
  error?: string;
  /** Where a loaded statement came from: cache / repo / live LeetCode / offline. */
  source?: "cache" | "repo" | "live" | "offline";
}

/** A single-line text prompt (search / import). */
export interface InputState {
  kind: "search" | "import";
  value: string;
}

/**
 * Settings overlay. `index` selects a field; when `editing` is true the field's
 * `draft` is being typed. Values live in `working` until saved on close.
 */
export interface ConfigState {
  index: number;
  editing: boolean;
  draft: string;
  working: Config;
  /**
   * Open checkbox submenu for a `multiselect` field, or null when the settings
   * list itself has focus. `choices` is supplied by the caller (the bundled
   * list names) so config.ts stays free of any knowledge of what lists exist.
   */
  picker: { key: ConfigKey; choices: string[]; index: number } | null;
  /**
   * Autocomplete candidates for a text field (currently the sync repo — the
   * user's GitHub repos, fetched once via `gh`). Filtered against `draft` at
   * render time; `suggestIndex` highlights one for Tab-to-accept. Empty until
   * the async fetch lands (or if `gh` is unavailable).
   */
  repoSuggestions: string[];
  suggestIndex: number;
}

/** The Sync overlay's actions, in menu order. */
export const SYNC_ACTIONS = [
  { key: "auth", label: "Authenticate", hint: "grab your LeetCode session from a browser" },
  { key: "pull", label: "Pull solved from LeetCode", hint: "mark done what you've solved on your account" },
  { key: "markRepo", label: "Mark solved from sync repo", hint: "mark done from the folders in your sync repo" },
  { key: "pullSolutions", label: "Pull my solutions → repo", hint: "add LeetCode-solved problems missing from your sync repo" },
  { key: "pushDir", label: "Commit + push solutions dir", hint: "git add/commit/push your ./solutions files to the sync repo" },
  { key: "push", label: "Push solutions to LeetCode", hint: "submit NeetCode solutions to mark Accepted" },
] as const;
export type SyncAction = (typeof SYNC_ACTIONS)[number]["key"];

/**
 * Sync overlay: a small menu (auth / pull / push) plus a scrolling log of the
 * running action. `busy` blocks re-entry; `confirmPush` gates the destructive
 * push behind an explicit yes.
 */
export interface SyncState {
  index: number;
  busy: boolean;
  /** Log lines from the current/last action (progress + results). */
  lines: string[];
  /** When set, push is awaiting y/n confirmation; holds the plan count. */
  confirmPush: number | null;
  /**
   * A generic pending confirmation for the git actions (pull-solutions / push
   * dir), gated behind y/n like `confirmPush`. `prompt` is the footer question;
   * `action` picks which runner fires on `y`.
   */
  confirm: { action: "pullSolutions" | "pushDir"; prompt: string } | null;
}

/**
 * The hierarchical panels (lists → problems → preview → logs) plus the bottom
 * menu bar. Tab/→ moves deeper, Shift-Tab/← moves back; the menu is reachable
 * from any panel and returns focus to where it was.
 */
export type Focus = "lists" | "problems" | "preview" | "logs" | "menu";

/** Sentinel list name for the "★ Recommended" pseudo-list at the top of Lists. */
export const RECOMMENDED_LIST = "★ recommended";

/** Captured test-run state for the Logs panel (beside Preview). */
export interface LogsState {
  /** Slug the log belongs to (so it invalidates when the selection changes). */
  slug: string | null;
  status: "idle" | "running" | "done";
  /** Captured compile + run output, line-wrapped for the panel width. */
  lines: string[];
  scroll: number;
  /** Pass/fail summary shown in the panel header once done. */
  summary?: string;
  ok?: boolean;
}

export interface State {
  list: ProblemList;
  listNames: string[];
  /**
   * The de-duplicated union of every bundled list's problems. The roadmap counts
   * against this (subset-scoped), so its DAG is a global, list-independent view —
   * not whatever list happens to be selected.
   */
  allProblems: Problem[];
  /** Problem ids per bundled list, for the Lists panel's unsolved/total counts. */
  listMeta: Map<string, number[]>;
  /** Ranked recommendations; shown as their own pseudo-list in the Lists panel. */
  recommended: Recommendation[];
  /** True while the Problems panel is showing the recommended set, not `list`. */
  showingRecommended: boolean;
  completed: Set<number>;
  doneFilter: DoneFilter;
  diff: Difficulty | undefined;
  /** Active NeetCode-pattern filter; empty = no tag filter. */
  tagFilter: Set<string>;
  /** Tag-picker overlay (checklist of patterns), or null. */
  tagPicker: { index: number } | null;
  /**
   * Roadmap overlay, or null. `chart` picks the NeetCode DAG vs the full
   * pattern→topics chart; `subset` scopes the done/total counts. `cursor` is a
   * flat index into the chart's node list.
   */
  roadmap: { cursor: number; chart: RoadmapChart; subset: RoadmapSubset } | null;
  search: string;
  sortKey: SortKey;
  sortDesc: boolean;
  filtered: Problem[];
  /** Cursor within the Problems panel. */
  cursor: number;
  top: number;
  /** Cursor within the Lists panel (0 = ★ Recommended, then each list name). */
  listCursor: number;
  listTop: number;
  focus: Focus;
  /** Panel focus is restored to this when leaving the menu. */
  lastPanel: Exclude<Focus, "menu">;
  menuIndex: number;
  preview: PreviewState;
  /** Captured output of the last test run, shown in the Logs panel. */
  logs: LogsState;
  maxId: number;
  /** Transient message shown in the footer (cleared on next navigation). */
  status: string;
  /** Active text prompt, or null. */
  input: InputState | null;
  /** Active config overlay, or null. */
  config: ConfigState | null;
  /** Active sync overlay (auth / pull / push), or null. */
  sync: SyncState | null;
  /** Pending push work list, staged between the plan and confirm+run steps. */
  syncWork?: { pr: Problem; code: string }[];
  /** Whether the help overlay is showing. */
  help: boolean;
  /** Live prefetch status shown in the footer; null when idle. */
  prefetch: string | null;
  /** First-run: offer to pre-cache the study set (shown once). */
  suggestSetup: boolean;
  /**
   * Fullscreen reading mode: the Preview and Logs panels take the whole screen
   * (split when there's room), hiding Lists/Problems. Focus stays on preview or
   * logs; F toggles it, Esc/← leaves it.
   */
  fullscreen: boolean;
}

/**
 * The Lists panel's rows: the ★ Recommended sentinel, then the synthetic "all"
 * union, then every real list name.
 */
export function listRows(s: State): string[] {
  return [RECOMMENDED_LIST, ALL_LIST_NAME, ...s.listNames];
}

/** Row index of a Lists-panel entry, or 0 (★ Recommended) if not found. */
export function listRows0(s: State, name: string): number {
  const i = listRows(s).indexOf(name);
  return i < 0 ? 0 : i;
}

export function recompute(s: State): void {
  const done = s.doneFilter === "all" ? undefined : s.doneFilter === "done";
  // Source problems: the recommended set (pseudo-list) or the current list.
  const source = s.showingRecommended
    ? s.recommended.map((r) => r.problem)
    : s.list.problems;
  const out = filterProblems(source, {
    difficulty: s.diff,
    completed: s.completed,
    patterns: s.tagFilter.size > 0 ? [...s.tagFilter] : undefined,
    done,
  });
  // Search is fuzzy (title + pattern + topics + company) and defines the order
  // by relevance; without a query, the chosen sort applies.
  if (s.search.trim()) {
    s.filtered = fuzzyRankProblems(out, s.search, (p) => listsContaining(s, p.id));
  } else {
    s.filtered = sortProblems(out, s.sortKey, s.sortDesc);
  }
  if (s.cursor >= s.filtered.length) s.cursor = Math.max(0, s.filtered.length - 1);
}

export function current(s: State): Problem | undefined {
  return s.filtered[s.cursor];
}

/**
 * Done / remaining / total counts for a bundled list, computed live against the
 * current completed set. Unknown lists (no metadata loaded) report zeros.
 */
export function listCounts(
  s: State,
  name: string,
): { done: number; remaining: number; total: number } {
  const ids = s.listMeta.get(name) ?? [];
  const done = ids.reduce((n, id) => n + (s.completed.has(id) ? 1 : 0), 0);
  return { done, remaining: ids.length - done, total: ids.length };
}

/** Bundled lists (by name, sorted) that contain the given problem id. */
export function listsContaining(s: State, id: number): string[] {
  const names: string[] = [];
  for (const name of s.listNames) {
    if ((s.listMeta.get(name) ?? []).includes(id)) names.push(name);
  }
  return names;
}

/**
 * Point the Problems panel at a Lists-panel row: either the ★ Recommended
 * pseudo-list or a bundled list by name. Resets the problem cursor/preview.
 */
export async function selectListRow(s: State, name: string): Promise<void> {
  if (name === RECOMMENDED_LIST) {
    s.showingRecommended = true;
    s.maxId = s.recommended.reduce((m, r) => Math.max(m, r.problem.id), 0);
  } else {
    s.showingRecommended = false;
    s.list = await loadList(name);
    s.maxId = s.list.problems.reduce((m, p) => Math.max(m, p.id), 0);
  }
  s.cursor = 0;
  s.top = 0;
  s.preview = { slug: null, status: "idle", text: "", scroll: 0 };
  recompute(s);
}

/** Human label for the Problems-panel header: list title or "Recommended". */
export function currentViewTitle(s: State): string {
  return s.showingRecommended ? "Recommended" : s.list.title;
}
