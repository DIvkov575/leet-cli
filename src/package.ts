/**
 * Package one problem's fetched data into the three split artifacts that get
 * synced into the solutions repo:
 *   <id>-<slug>.md         — rendered description + examples
 *   <id>-<slug>.cpp        — C++ stub + test harness (via scaffoldContent)
 *   <id>-<slug>.tests.txt  — raw LeetCode example cases (stdin format)
 *
 * Pure functions only: they take fetched fields and return file contents, so
 * they are trivially testable and free of I/O.
 */
import { htmlToText } from "./render.ts";
import { scaffoldContent, type ScaffoldInput } from "./scaffold.ts";

/** Everything needed to package a problem; superset of ScaffoldInput. */
export interface PackageInput extends ScaffoldInput {
  /** Lists (bundled names) this problem belongs to, for the description header. */
  lists?: string[];
}

/** One packaged artifact: a repo-relative filename and its contents. */
export interface Artifact {
  filename: string;
  content: string;
}

/** Base filename stem, e.g. "1-two-sum". */
export function stem(id: number, slug: string): string {
  return `${id}-${slug}`;
}

/** Markdown description: title, meta, link, then the statement as text. */
export function descriptionMarkdown(input: PackageInput): string {
  const lines = [
    `# ${input.id}. ${input.title}`,
    "",
    `- **Difficulty:** ${input.difficulty}`,
    `- **URL:** ${input.url}`,
  ];
  if (input.lists && input.lists.length > 0) {
    lines.push(`- **Lists:** ${input.lists.join(", ")}`);
  }
  lines.push("");
  const body = input.contentHtml ? htmlToText(input.contentHtml).trim() : "_No description available._";
  lines.push(body, "");
  return lines.join("\n");
}

/** Raw example cases in LeetCode's stdin format (one value per line). */
export function testsText(input: PackageInput): string {
  const raw = (input.exampleTestcases ?? "").trim();
  return raw.length > 0 ? raw + "\n" : "";
}

/** Produce all three artifacts for a problem. */
export function packageProblem(input: PackageInput): Artifact[] {
  const base = stem(input.id, input.slug);
  const artifacts: Artifact[] = [
    { filename: `${base}.md`, content: descriptionMarkdown(input) },
    { filename: `${base}.cpp`, content: scaffoldContent(input) },
  ];
  const tests = testsText(input);
  if (tests.length > 0) {
    artifacts.push({ filename: `${base}.tests.txt`, content: tests });
  }
  return artifacts;
}
