import type { CodeSnippet } from "./leetcode.ts";

/** Metadata needed to render a scaffolded solution file. */
export interface ScaffoldInput {
  id: number;
  title: string;
  slug: string;
  difficulty: string;
  url: string;
  snippets: CodeSnippet[];
}

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

/** Build the full contents of a scaffolded C++ solution file. */
export function scaffoldContent(input: ScaffoldInput): string {
  const header = [
    `// ${input.id}. ${input.title} [${input.difficulty}]`,
    `// ${input.url}`,
    "",
  ].join("\n");
  return `${header}${cppSnippet(input.snippets)}\n`;
}
