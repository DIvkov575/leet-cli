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

/** Relative path (from ./solutions) for a scaffolded C++ file, e.g. "1-two-sum.cpp". */
export function scaffoldFilename(id: number, slug: string): string {
  return `${id}-${slug}.cpp`;
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
  const parts = [header, INCLUDES, "", stub];

  const meta = parseMeta(input.metaData);
  const cases =
    meta && input.exampleTestcases !== undefined
      ? buildCases(input.exampleTestcases, input.contentHtml ?? "", meta.params.length)
      : [];

  if (meta) {
    const harness = generateHarness(meta, cases);
    if (harness.supported && harness.code) {
      parts.push("", harness.code);
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
