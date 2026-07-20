import type { CodeSnippet } from "./leetcode.ts";
import {
  buildCases,
  generateHarness,
  type ExampleCase,
  type ProblemMeta,
} from "./harness.ts";
import { CUSTOM_HARNESS_SLUGS, CUSTOM_NODE_STRUCTS, generateCustomHarness } from "./custom-harness.ts";
import { statementCommentLines } from "./render.ts";

/** Metadata needed to render a scaffolded solution file. */
export interface ScaffoldInput {
  id: number;
  title: string;
  slug: string;
  difficulty: string;
  url: string;
  snippets: CodeSnippet[];
  /** Raw LeetCode metaData JSON, if available (enables the test harness). */
  metaData?: string;
  /** Newline-separated example inputs, if available. */
  exampleTestcases?: string;
  /** Problem statement HTML, used to extract expected outputs. */
  contentHtml?: string;
}

/** Standard includes so the file compiles under Apple clang (no bits/stdc++.h). */
const INCLUDES = [
  "#include <algorithm>",
  "#include <climits>",
  "#include <cmath>",
  "#include <iostream>",
  "#include <map>",
  "#include <optional>",
  "#include <queue>",
  "#include <set>",
  "#include <sstream>",
  "#include <stack>",
  "#include <string>",
  "#include <unordered_map>",
  "#include <unordered_set>",
  "#include <vector>",
  "using namespace std;",
].join("\n");

/** Pick the C++ starter snippet, or throw if the problem has none. */
export function cppSnippet(snippets: CodeSnippet[]): string {
  const cpp = snippets.find((s) => s.langSlug === "cpp");
  if (!cpp) throw new Error("LeetCode returned no C++ starter code for this problem");
  return cpp.code;
}

/**
 * LeetCode's own struct definitions, ordinarily shipped only inside a doc
 * comment above the stub (mirroring leetcode.com, where the judge supplies
 * the real struct) — so a stub referencing ListNode/TreeNode doesn't
 * actually compile as scaffolded. Each entry is the canonical, full-constructor
 * form; a solution that only uses the single-arg constructor still compiles
 * against the full form.
 */
const NODE_STRUCTS: Record<string, string> = {
  ListNode: [
    "struct ListNode {",
    "    int val;",
    "    ListNode *next;",
    "    ListNode() : val(0), next(nullptr) {}",
    "    ListNode(int x) : val(x), next(nullptr) {}",
    "    ListNode(int x, ListNode *next) : val(x), next(next) {}",
    "};",
  ].join("\n"),
  TreeNode: [
    "struct TreeNode {",
    "    int val;",
    "    TreeNode *left;",
    "    TreeNode *right;",
    "    TreeNode() : val(0), left(nullptr), right(nullptr) {}",
    "    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}",
    "    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}",
    "};",
  ].join("\n"),
};

/**
 * Real (compilable) struct definitions for every LeetCode node type the stub
 * references by whole-word identifier — `ListNode`, `TreeNode`, or both, in
 * that order. Empty when the stub references neither.
 *
 * For the handful of slugs with a differently-shaped custom `Node` struct
 * (see `CUSTOM_NODE_STRUCTS`), that struct is injected instead — the stub
 * for these uses the bare identifier `Node`, never `ListNode`/`TreeNode`, so
 * the whole-word scan below would otherwise find nothing to inject at all.
 */
function nodeStructDefs(stub: string, slug: string): string {
  if (Object.hasOwn(CUSTOM_NODE_STRUCTS, slug)) return CUSTOM_NODE_STRUCTS[slug]!;
  const defs: string[] = [];
  for (const [name, def] of Object.entries(NODE_STRUCTS)) {
    if (new RegExp(`\\b${name}\\b`).test(stub)) defs.push(def);
  }
  return defs.join("\n\n");
}

/** Relative path (from ./solutions) for a scaffolded C++ file, e.g. "1-two-sum.cpp". */
export function scaffoldFilename(id: number, slug: string): string {
  return `${id}-${slug}.cpp`;
}

/**
 * Sentinel that separates the user's editable solution (above) from the local
 * test harness (below). LeetCode's judge supplies its own `main`, so the submit
 * path must strip everything from this line down; see `solutionCodeForSubmit`.
 */
export const HARNESS_MARKER = "// ===== leet-cli test harness (not submitted) =====";

/**
 * Sentinels bracketing an injected ListNode/TreeNode struct block (see
 * `nodeStructDefs`). LeetCode's judge supplies its own definition of these
 * structs, so the submit path must strip the bracketed block even when no
 * harness was generated (e.g. a denylisted/gap problem still gets the
 * struct, just no `HARNESS_MARKER`).
 */
export const STRUCT_MARKER_START = "// ===== leet-cli struct defs (not submitted) =====";
export const STRUCT_MARKER_END = "// ===== end struct defs =====";

/**
 * Extract just the part of a scaffolded file to submit to LeetCode: everything
 * above the harness marker, with any struct-defs block (see `STRUCT_MARKER_*`)
 * removed first — LeetCode's judge already defines ListNode/TreeNode itself,
 * so submitting our own copy would redefine it. Files scaffolded before the
 * markers existed (or with no harness) fall back to stripping a trailing
 * `int main()` block, or the whole file if neither is present (a hand-written
 * solution with no harness).
 */
export function solutionCodeForSubmit(cpp: string): string {
  const structStart = cpp.indexOf(STRUCT_MARKER_START);
  const structEndAt = cpp.indexOf(STRUCT_MARKER_END);
  const withoutStruct =
    structStart >= 0 && structEndAt > structStart
      ? cpp.slice(0, structStart) + cpp.slice(structEndAt + STRUCT_MARKER_END.length + 1)
      : cpp;

  const markerAt = withoutStruct.indexOf(HARNESS_MARKER);
  if (markerAt >= 0) return withoutStruct.slice(0, markerAt).trimEnd() + "\n";

  // Legacy fallback (files/bundle scaffolded before the marker existed): cut off
  // the harness. It begins with the `__show` helper block (preceded by a
  // `template <typename T>` line) and then `int main()`; drop from the earliest
  // of those, including a `template` line that immediately precedes `__show` so
  // we never leave a dangling template head that wouldn't compile.
  const lines = withoutStruct.split("\n");
  let cutLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.includes("static void __show(") || l.startsWith("int main(")) {
      cutLine = i;
      // If a bare `template <...>` line sits directly above, cut from it instead.
      if (i > 0 && lines[i - 1]!.trim().startsWith("template")) cutLine = i - 1;
      break;
    }
  }
  if (cutLine >= 0) return lines.slice(0, cutLine).join("\n").trimEnd() + "\n";
  return withoutStruct;
}

/** Render example cases as a comment block (fallback when no harness is generated). */
function casesComment(cases: ExampleCase[]): string {
  if (cases.length === 0) return "";
  const lines = ["// Example cases (input lines -> expected):"];
  for (const c of cases) {
    lines.push(`//   ${c.args.join(" | ")}  ->  ${c.expected ?? "?"}`);
  }
  return lines.join("\n") + "\n";
}

/** Parse metaData JSON into a ProblemMeta, or null if absent/malformed. */
function parseMeta(metaData: string | undefined): ProblemMeta | null {
  if (!metaData) return null;
  try {
    const m = JSON.parse(metaData) as ProblemMeta;
    if (!m.name || !Array.isArray(m.params) || !m.return) return null;
    return m;
  } catch {
    return null;
  }
}

/**
 * LeetCode's metaData is occasionally wrong: some problems (e.g.
 * populating-next-right-pointers-in-each-node-ii) report a param/return type
 * of "ListNode"/"TreeNode" even though the actual C++ stub defines and uses
 * a differently-shaped `Node` struct (an extra random/next field).
 * Cross-checking against the stub itself — the same whole-word test
 * nodeStructDefs uses to decide whether to inject a struct — catches this
 * generically, without needing to know every affected slug. (The two known
 * slugs with this exact issue have a hand-written generator in
 * custom-harness.ts and are dispatched before this check ever runs; this
 * remains as a safety net for any other problem with the same metaData quirk.)
 */
function metaDataClaimsUnusedNodeType(meta: ProblemMeta, stub: string): boolean {
  const allTypes = [...meta.params.map((p) => p.type), meta.return.type];
  const claimed = new Set(
    Object.keys(NODE_STRUCTS).filter((name) => allTypes.some((t) => t.includes(name))),
  );
  for (const name of claimed) {
    if (!new RegExp(`\\b${name}\\b`).test(stub)) return true;
  }
  return false;
}

/**
 * The generic harness always calls `Solution().<method>(...)` — that only
 * makes sense when the stub actually defines `class Solution`. Multi-method
 * "design"/Codec problems use a differently-named class, and their
 * metaData.name is the *class* name, not a callable method — generating a
 * harness for them would emit nonsense like `Solution().Codec(...)`. (The one
 * known bundled problem with this shape,
 * serialize-and-deserialize-binary-tree, has a hand-written generator in
 * custom-harness.ts and is dispatched before this check ever runs; this
 * remains as a safety net for any other multi-method problem.)
 */
function stubHasSolutionClass(stub: string): boolean {
  return /\bclass\s+Solution\b/.test(stub);
}

/**
 * Decide whether to generate a harness for this problem: tries the
 * hand-written per-slug generator first (custom-harness.ts, for shapes the
 * generic model can't express at all — a locator param that isn't a real
 * argument, a differently-shaped Node struct, a multi-method class), then
 * falls through to the structural guards above and generateHarness's own
 * type-level checks.
 */
function resolveHarness(
  slug: string,
  meta: ProblemMeta,
  cases: ExampleCase[],
  stub: string,
  exampleTestcases: string,
  contentHtml: string,
): ReturnType<typeof generateHarness> {
  if (CUSTOM_HARNESS_SLUGS.has(slug)) {
    const custom = generateCustomHarness(slug, exampleTestcases, contentHtml);
    if (custom) return custom;
    return { supported: false, reason: "example testcases did not parse into any usable case" };
  }
  if (!stubHasSolutionClass(stub)) {
    return {
      supported: false,
      reason: "the stub defines a multi-method class (not Solution) — no single method to call",
    };
  }
  if (metaDataClaimsUnusedNodeType(meta, stub)) {
    return {
      supported: false,
      reason: "metaData reports ListNode/TreeNode but the stub defines a differently-shaped Node struct",
    };
  }
  return generateHarness(meta, cases);
}

/**
 * Build the full contents of a scaffolded C++ solution file: header, includes,
 * starter stub, and either a runnable test harness (when the signature and
 * examples support it) or the example cases as a comment.
 */
export function scaffoldContent(input: ScaffoldInput): string {
  let header = `// ${input.id}. ${input.title} [${input.difficulty}]\n// ${input.url}\n`;
  // Embed the statement as a `//` comment block between the header and the
  // includes, so the description travels with the code file (readable in an
  // editor, stripped by the compiler). Omitted when no statement is available.
  if (input.contentHtml) {
    const body = statementCommentLines(input.contentHtml, "// ");
    if (body.length > 0) header += "//\n" + body.join("\n") + "\n";
  }
  const stub = cppSnippet(input.snippets);
  const structs = nodeStructDefs(stub, input.slug);
  const parts = structs
    ? [header, INCLUDES, "", STRUCT_MARKER_START, structs, STRUCT_MARKER_END, "", stub]
    : [header, INCLUDES, "", stub];

  const meta = parseMeta(input.metaData);
  const cases =
    meta && input.exampleTestcases !== undefined
      ? buildCases(input.exampleTestcases, input.contentHtml ?? "", meta.params.length)
      : [];

  if (meta) {
    const harness = resolveHarness(
      input.slug,
      meta,
      cases,
      stub,
      input.exampleTestcases ?? "",
      input.contentHtml ?? "",
    );
    if (harness.supported && harness.code) {
      // Marker line lets the submit path strip the harness cleanly (LeetCode
      // supplies its own main); it's an ordinary comment to the compiler.
      parts.push("", HARNESS_MARKER, harness.code);
      return parts.join("\n") + "\n";
    }
    // Unsupported signature — keep the examples visible as a comment.
    const comment = casesComment(cases);
    parts.push(
      "",
      `// No test harness: ${harness.reason}.`,
      comment.trimEnd(),
    );
    return parts.filter((p) => p !== "").join("\n") + "\n";
  }

  return parts.join("\n") + "\n";
}
