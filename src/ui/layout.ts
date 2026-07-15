/**
 * Pure layout math for the TUI: column widths for the problems table, the
 * scrolling-window top, and plain-text word wrapping. No ANSI, no state.
 */

export interface Columns {
  idW: number;
  titleW: number;
  accW: number;
  diffW: number;
}

/**
 * Compute column widths for a given pane width. `id`/acc/diff are fixed to
 * their content; the title column absorbs the remainder and is never allowed
 * to wrap — it truncates instead. Returns titleW >= 0.
 */
export function layoutColumns(paneWidth: number, maxId: number): Columns {
  const idW = Math.max(String(maxId).length, 1);
  const accW = 6; // "100.0%"
  const diffW = 6; // "Medium"
  const statusW = 1;
  const gaps = 4; // one space between each of the 5 fields
  const titleW = Math.max(0, paneWidth - statusW - idW - accW - diffW - gaps);
  return { idW, titleW, accW, diffW };
}

/**
 * Scrolling window: given a cursor and viewport height, return the slice of
 * indices [top, top+height) that keeps the cursor visible.
 */
export function computeTop(cursor: number, total: number, height: number, prevTop: number): number {
  if (height <= 0 || total <= height) return 0;
  let top = prevTop;
  if (cursor < top) top = cursor;
  else if (cursor >= top + height) top = cursor - height + 1;
  return Math.max(0, Math.min(top, total - height));
}

/** Word-wrap plain text to `width`, preserving blank lines. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of rawLine.split(/\s+/)) {
      if (word.length > width) {
        // Hard-break a single over-long token.
        if (line) {
          out.push(line);
          line = "";
        }
        for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
        continue;
      }
      if (line.length + (line ? 1 : 0) + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}
