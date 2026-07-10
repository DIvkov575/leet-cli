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
}

/** A settings key that keeps the same discipline as an env fallback. */
export type ConfigKey = keyof Config;

/** Describes each editable setting for the config UI (order = display order). */
export interface ConfigField {
  key: ConfigKey;
  label: string;
  /** What an unset value falls back to, shown as the placeholder. */
  fallback: string;
}

export const CONFIG_FIELDS: readonly ConfigField[] = [
  { key: "editor", label: "Editor command", fallback: "$VISUAL / $EDITOR, else nvim/vim/vi" },
  { key: "solutionsDir", label: "Solutions directory", fallback: "solutions" },
  { key: "cxx", label: "C++ compiler", fallback: "$CXX, else c++" },
  { key: "recommend", label: "Recommend ranking", fallback: "popularity (or: acceptance)" },
] as const;

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

/** Keep only known string keys with non-empty values. */
function sanitize(raw: Record<string, unknown>): Config {
  const cfg: Config = {};
  for (const { key } of CONFIG_FIELDS) {
    const v = raw[key];
    if (typeof v === "string" && v.trim() !== "") cfg[key] = v.trim();
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
