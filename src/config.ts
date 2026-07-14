import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * User configuration, persisted as JSON in the data dir alongside
 * `completed.json`. Every field is optional; an unset field falls back to the
 * relevant environment variable and then a built-in default, so the file only
 * ever needs to hold the values the user actually overrode.
 */
export interface Config {
  /** Editor command for `solve -o`, e.g. "code -w". Overrides $VISUAL/$EDITOR. */
  editor?: string;
  /** Output directory for scaffolded solution files. Overrides the "solutions" default. */
  solutionsDir?: string;
  /** C++ compiler for `leet test`. Overrides $CXX. */
  cxx?: string;
  /** Ranking strategy for the recommended-problems panel (e.g. "popularity", "acceptance"). */
  recommend?: string;
  /**
   * List names EXCLUDED from the recommended-problems pool. Stored as the set of
   * de-selected lists (the complement of what the include-checklist shows), so
   * the default — unset/empty — means *every* list counts and ★ Recommended is
   * populated out of the box. Excluded lists stay fully browsable; they just
   * stop contributing to the cross-list popularity signal.
   */
  recommendExclude?: string[];
  /**
   * LeetCode session cookie for `import --adapter leetcode`. Deliberately NOT in
   * CONFIG_FIELDS so it's never shown/edited in the TUI (it's a credential);
   * set it via the LEETCODE_SESSION env var, or hand-edit config.json.
   */
  leetcodeSession?: string;
  /** Matching CSRF token (LEETCODE_CSRF env var); optional. */
  leetcodeCsrf?: string;
}

/** A settings key that keeps the same discipline as an env fallback. */
export type ConfigKey = keyof Config;

/**
 * How a setting is edited in the TUI. `text` fields are typed in freehand;
 * `multiselect` fields open a checkbox submenu over a set of choices supplied
 * by the caller (the bundled list names, for `recommendExclude`).
 */
export type ConfigFieldKind = "text" | "multiselect";

/** Describes each editable setting for the config UI (order = display order). */
export interface ConfigField {
  key: ConfigKey;
  label: string;
  kind: ConfigFieldKind;
  /** What an unset value falls back to, shown as the placeholder. */
  fallback: string;
}

export const CONFIG_FIELDS: readonly ConfigField[] = [
  {
    key: "editor",
    label: "Editor command",
    kind: "text",
    fallback: "$VISUAL / $EDITOR, else nvim/vim/vi",
  },
  { key: "solutionsDir", label: "Solutions directory", kind: "text", fallback: "solutions" },
  { key: "cxx", label: "C++ compiler", kind: "text", fallback: "$CXX, else c++" },
  {
    key: "recommend",
    label: "Recommend ranking",
    kind: "text",
    fallback: "popularity (or: acceptance)",
  },
  {
    key: "recommendExclude",
    label: "Recommend: include lists",
    kind: "multiselect",
    fallback: "all lists included",
  },
] as const;

/** The keys that hold a string array rather than a string. */
const LIST_KEYS: ConfigKey[] = ["recommendExclude"];

/**
 * Add/remove `name` from a multiselect field's value. Pure, so the TUI's
 * checkbox submenu is a thin shell over it. Comparison is case-insensitive to
 * match `excludeLists`; the stored casing is whatever the caller passed in.
 * Returns a new array — never mutates.
 */
export function toggleSelection(current: readonly string[] | undefined, name: string): string[] {
  const items = current ?? [];
  const key = name.trim().toLowerCase();
  const without = items.filter((n) => n.trim().toLowerCase() !== key);
  // Present -> removing it. Absent -> adding it.
  return without.length < items.length ? without : [...items, name];
}

/** Directory holding user state. Honors LEET_DATA_DIR (used by tests), then XDG. */
function dataDir(): string {
  return (
    process.env.LEET_DATA_DIR ??
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "leet-cli")
  );
}

function configPath(): string {
  return join(dataDir(), "config.json");
}

// Credential keys live in the config file but are hidden from the TUI editor,
// so they aren't in CONFIG_FIELDS; keep them across load/save explicitly.
const EXTRA_STRING_KEYS: ConfigKey[] = ["leetcodeSession", "leetcodeCsrf"];

/**
 * Keep only known keys with meaningful values. String keys must be non-blank;
 * list keys must be arrays of non-blank strings (junk entries are dropped, and
 * an empty result is omitted entirely so the file stays minimal).
 */
function sanitize(raw: Record<string, unknown>): Config {
  const cfg: Config = {};
  const keys = [...CONFIG_FIELDS.map((f) => f.key), ...EXTRA_STRING_KEYS];
  for (const key of keys) {
    const v = raw[key];
    if (LIST_KEYS.includes(key)) {
      if (!Array.isArray(v)) continue;
      const items = v
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter((x) => x !== "");
      if (items.length > 0) (cfg[key] as string[]) = items;
    } else if (typeof v === "string" && v.trim() !== "") {
      (cfg[key] as string) = v.trim();
    }
  }
  return cfg;
}

/** Load user config. Missing/garbage file -> empty config. */
export async function loadConfig(): Promise<Config> {
  const file = Bun.file(configPath());
  if (!(await file.exists())) return {};
  try {
    return sanitize((await file.json()) as Record<string, unknown>);
  } catch {
    return {};
  }
}

/** Persist config, dropping empty/blank fields so the file stays minimal. */
export async function saveConfig(cfg: Config): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const clean = sanitize(cfg as Record<string, unknown>);
  await Bun.write(configPath(), JSON.stringify(clean, null, 2) + "\n");
}

type Env = Record<string, string | undefined>;

/**
 * Editor command: config `editor` > $VISUAL > $EDITOR > undefined. Returns
 * undefined when nothing is set so the caller can pick the best installed
 * editor (Bun.which) itself.
 */
export function resolveEditor(cfg: Config, env: Env = process.env): string | undefined {
  return cfg.editor || env.VISUAL || env.EDITOR || undefined;
}

/** Solutions dir: explicit CLI flag > config `solutionsDir` > "solutions". */
export function resolveSolutionsDir(flag: string | undefined, cfg: Config): string {
  return flag ?? cfg.solutionsDir ?? "solutions";
}

/** C++ compiler: config `cxx` > $CXX > "c++". */
export function resolveCxx(cfg: Config, env: Env = process.env): string {
  return cfg.cxx || env.CXX || "c++";
}

/**
 * LeetCode auth for `import --adapter leetcode`: env vars win over config so a
 * shell-exported cookie is used without touching the file. Returns null when no
 * session is available.
 */
export function resolveLeetCodeAuth(
  cfg: Config,
  env: Env = process.env,
): { session: string; csrf?: string } | null {
  const session = env.LEETCODE_SESSION || cfg.leetcodeSession;
  if (!session) return null;
  const csrf = env.LEETCODE_CSRF || cfg.leetcodeCsrf || undefined;
  return { session, csrf };
}
