/**
 * ANSI/width primitives for the TUI: measuring, truncating, and padding strings
 * by *visible* columns (ignoring SGR escapes), plus the small color palette and
 * `paint` helper. Pure and TTY-agnostic — the only environment dependency is
 * whether color is emitted at all (`useColor`).
 */
import type { Difficulty } from "../types.ts";

// CSI SGR escapes ("\x1b[…m") — the only ANSI we emit (color/bold/reverse/reset).
// Matched globally for stripping, and with a sticky copy for position-anchored scans.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const ANSI_AT = /\x1b\[[0-9;]*m/y;
const RESET = "\x1b[0m";

/** Number of visible columns, ignoring ANSI escape sequences. */
export function visibleLength(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

/**
 * Truncate to `width` *visible* columns, marking cuts with a trailing "…".
 * ANSI escapes are copied through without counting toward the width, and if the
 * input carried any styling the result is closed with a reset so it can't bleed
 * into the rest of the frame — important because rows are often fit() twice
 * (once when styled, again when composed into an overlay).
 */
export function truncate(s: string, width: number): string {
  if (width <= 0) return "";
  if (visibleLength(s) <= width) return s;

  const target = width - 1; // leave a column for the ellipsis
  let out = "";
  let count = 0;
  let i = 0;
  while (i < s.length && count < target) {
    ANSI_AT.lastIndex = i;
    const m = ANSI_AT.exec(s);
    if (m) {
      out += m[0]; // escape: emit verbatim, does not consume a column
      i += m[0].length;
      continue;
    }
    out += s[i]!;
    count++;
    i++;
  }
  out += "…";
  // Close any styling opened before the cut so it doesn't leak downstream.
  if (s.includes("\x1b[")) out += RESET;
  return out;
}

/** Pad (right) or truncate to exactly `width` visible columns. */
export function fit(s: string, width: number): string {
  if (width <= 0) return "";
  const t = truncate(s, width);
  return t + " ".repeat(Math.max(0, width - visibleLength(t)));
}

// ─── color ───────────────────────────────────────────────────────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
export const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  rev: "\x1b[7m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
} as const;

/** Wrap `s` in the given SGR codes (no-op when color is disabled). */
export function paint(s: string, ...codes: (keyof typeof C)[]): string {
  if (!useColor) return s;
  return codes.map((k) => C[k]).join("") + s + C.reset;
}

/** The palette key for a difficulty (green/yellow/red). */
export function diffColor(d: Difficulty): keyof typeof C {
  return d === "Easy" ? "green" : d === "Medium" ? "yellow" : "red";
}
