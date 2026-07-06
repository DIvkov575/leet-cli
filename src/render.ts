import type { Difficulty, Problem } from "./types.ts";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const codes = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
} as const;

function paint(s: string, ...c: (keyof typeof codes)[]): string {
  if (!useColor) return s;
  return c.map((k) => codes[k]).join("") + s + codes.reset;
}

function difficultyColor(d: Difficulty): keyof typeof codes {
  return d === "Easy" ? "green" : d === "Medium" ? "yellow" : "red";
}

function acc(p: Problem): string {
  return p.acceptance === null ? "—" : `${p.acceptance.toFixed(1)}%`;
}

/**
 * Render problems as an aligned table. When `completed` is given, a leading
 * status column shows `✓` for done problems (green) and a blank otherwise.
 */
export function renderTable(problems: Problem[], completed?: Set<number>): string {
  if (problems.length === 0) return paint("(no matching problems)", "dim");

  const showStatus = completed !== undefined;
  const rows = problems.map((p) => ({
    done: completed?.has(p.id) ?? false,
    id: String(p.id),
    title: p.title,
    acc: acc(p),
    diff: p.difficulty,
    p,
  }));

  const w = (sel: (r: (typeof rows)[number]) => string) =>
    Math.max(...rows.map((r) => sel(r).length));
  const idW = Math.max(w((r) => r.id), 1);
  const titleW = w((r) => r.title);
  const accW = Math.max(w((r) => r.acc), 4);

  const statusHead = showStatus ? " " + "  " : "";
  const header =
    statusHead +
    paint("#".padStart(idW), "bold", "dim") +
    "  " +
    paint("Problem".padEnd(titleW), "bold", "dim") +
    "  " +
    paint("Accept".padStart(accW), "bold", "dim") +
    "  " +
    paint("Difficulty", "bold", "dim");

  const lines = rows.map((r) => {
    const status = showStatus ? (r.done ? paint("✓", "green") : " ") + "  " : "";
    return (
      status +
      paint(r.id.padStart(idW), "dim") +
      "  " +
      r.title.padEnd(titleW) +
      "  " +
      r.acc.padStart(accW) +
      "  " +
      paint(r.diff, difficultyColor(r.p.difficulty))
    );
  });

  return [header, ...lines].join("\n");
}

/** Detailed single-problem view. When `done` is true, tag it as completed. */
export function renderProblem(p: Problem, contentHtml?: string, done?: boolean): string {
  const status = done ? "   " + paint("✓ done", "green") : "";
  const lines = [
    paint(`${p.id}. ${p.title}`, "bold", "cyan") + status,
    `${paint(p.difficulty, difficultyColor(p.difficulty))}   ${paint("Acceptance:", "dim")} ${acc(p)}`,
    paint(p.url, "dim"),
  ];
  if (contentHtml) {
    lines.push("", htmlToText(contentHtml));
  }
  return lines.join("\n");
}

/** Very small HTML -> text pass, good enough for reading problem statements. */
export function htmlToText(html: string): string {
  return html
    .replace(/<sup>/g, "^")
    .replace(/<sub>/g, "_")
    .replace(/<\/?(strong|b|em|code|pre|p|ul|ol)>/g, "")
    .replace(/<li>/g, "\n  - ")
    .replace(/<\/li>/g, "")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
