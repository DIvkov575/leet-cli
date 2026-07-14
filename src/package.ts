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
import { htmlToText, statementCommentLines } from "./render.ts";
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

/**
 * Raw example cases in LeetCode's stdin format (one value per line), with the
 * problem statement prepended as `#`-comment lines. The comment block is a
 * human reference only — the raw cases below it are byte-for-byte what a stdin
 * consumer reads, and `#` lines are conventionally ignored. Empty when there
 * are no example cases at all.
 */
export function testsText(input: PackageInput): string {
  const raw = (input.exampleTestcases ?? "").trim();
  if (raw.length === 0) return "";
  const comment = input.contentHtml ? statementCommentLines(input.contentHtml, "# ") : [];
  const prefix = comment.length > 0 ? comment.join("\n") + "\n\n" : "";
  return prefix + raw + "\n";
}

/** Options for substituting a NeetCode-sourced solution when LeetCode has no starter. */
export interface PackageOptions {
  /** Full C++ solution recovered from NeetCode, used in place of an official stub. */
  neetcodeCode?: string;
  /** Source URL of the NeetCode solution, for the file header. */
  neetcodeUrl?: string;
}

/** Header for a substituted NeetCode solution, marking its provenance. */
function neetcodeCppContent(input: PackageInput, code: string, url: string): string {
  return (
    `// ${input.id}. ${input.title} [${input.difficulty}]\n` +
    `// ${input.url}\n` +
    `// NOTE: LeetCode has no C++ starter for this problem (likely Premium).\n` +
    `// Solution sourced from NeetCode: ${url}\n\n` +
    code.trimEnd() +
    "\n"
  );
}

/** Produce all artifacts for a problem. With `neetcodeCode`, substitutes that solution for the stub. */
export function packageProblem(input: PackageInput, opts: PackageOptions = {}): Artifact[] {
  const base = stem(input.id, input.slug);
  const cpp =
    opts.neetcodeCode && opts.neetcodeUrl
      ? neetcodeCppContent(input, opts.neetcodeCode, opts.neetcodeUrl)
      : scaffoldContent(input);
  const artifacts: Artifact[] = [
    { filename: `${base}.md`, content: descriptionMarkdown(input) },
    { filename: `${base}.cpp`, content: cpp },
  ];
  const tests = testsText(input);
  if (tests.length > 0) {
    artifacts.push({ filename: `${base}.tests.txt`, content: tests });
  }
  return artifacts;
}

/**
 * Placeholder artifacts for a problem with no usable C++ starter. Writes a
 * `.cpp` whose header states why it's empty and an `.md` with the same note, so
 * the gap is explicit in the repo rather than a silent omission.
 */
export function packageMissing(input: PackageInput, reason: string, detail: string): Artifact[] {
  const base = stem(input.id, input.slug);
  const cpp =
    `// ${input.id}. ${input.title} [${input.difficulty}]\n` +
    `// ${input.url}\n` +
    `// NO C++ STARTER AVAILABLE (${reason}): ${detail}\n` +
    `// This problem cannot be scaffolded as C++. See MISSING.md.\n`;
  const md =
    descriptionMarkdown(input).trimEnd() +
    `\n\n---\n\n> **No C++ starter available** (${reason}): ${detail}\n`;
  const artifacts: Artifact[] = [
    { filename: `${base}.md`, content: md },
    { filename: `${base}.cpp`, content: cpp },
  ];
  const tests = testsText(input);
  if (tests.length > 0) {
    artifacts.push({ filename: `${base}.tests.txt`, content: tests });
  }
  return artifacts;
}
