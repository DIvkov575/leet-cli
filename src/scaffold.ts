import type { CodeSnippet } from "./leetcode.ts";
import {
  buildCases,
  generateHarness,
  type ExampleCase,
  type ProblemMeta,
} from "./harness.ts";
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
 */
function nodeStructDefs(stub: string): string {
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
 * Extract just the part of a scaffolded file to submit to LeetCode: everything
 * above the harness marker. Files scaffolded before the marker existed (or with
 * no harness) fall back to stripping a trailing `int main()` block, or the whole
 * file if neither is present (a hand-written solution with no harness).
 */
export function solutionCodeForSubmit(cpp: string): string {
  const markerAt = cpp.indexOf(HARNESS_MARKER);
  if (markerAt >= 0) return cpp.slice(0, markerAt).trimEnd() + "\n";

  // Legacy fallback (files/bundle scaffolded before the marker existed): cut off
  // the harness. It begins with the `__show` helper block (preceded by a
  // `template <typename T>` line) and then `int main()`; drop from the earliest
  // of those, including a `template` line that immediately precedes `__show` so
  // we never leave a dangling template head that wouldn't compile.
  const lines = cpp.split("\n");
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
  return cpp;
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
 * Slugs whose real LeetCode exampleTestcases carry an extra value per case
 * beyond what metaData.params declares — a "pos" index for the two cycle
 * problems (used only by LeetCode's own UI to draw the cycle), or a
 * reachable-but-undeclared head for delete-node-in-a-linked-list. Structurally
 * these look identical to a legitimately-supported single-param signature, so
 * generateHarness can't detect the mismatch on its own: it happily builds a
 * "supported" harness from the misaligned cases, which then fails *correct*
 * solutions. Denylisted by slug so no harness is ever generated for them.
 */
const HARNESS_DENYLIST = new Set([
  "linked-list-cycle",
  "linked-list-cycle-ii",
  "delete-node-in-a-linked-list",
]);

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
  const structs = nodeStructDefs(stub);
  const parts = structs ? [header, INCLUDES, "", structs, "", stub] : [header, INCLUDES, "", stub];

  const meta = parseMeta(input.metaData);
  const cases =
    meta && input.exampleTestcases !== undefined
      ? buildCases(input.exampleTestcases, input.contentHtml ?? "", meta.params.length)
      : [];

  if (meta) {
    const harness = HARNESS_DENYLIST.has(input.slug)
      ? {
          supported: false,
          reason:
            "example testcases carry an extra value not declared in metaData (would silently fail correct solutions)",
        }
      : generateHarness(meta, cases);
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
