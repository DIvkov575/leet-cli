/**
 * Read cookies from Firefox's cookie store. Unlike Chrome, Firefox stores cookie
 * values in plaintext in a SQLite DB (`cookies.sqlite`), so there's nothing to
 * decrypt and no Keychain prompt — the most reliable browser to pull a LeetCode
 * session from.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";

/** Firefox profiles dir on macOS. */
function profilesDir(): string {
  return join(homedir(), "Library", "Application Support", "Firefox", "Profiles");
}

/** Every profile that has a cookies.sqlite, preferring *.default-release first. */
export function firefoxCookieDbs(): string[] {
  const base = profilesDir();
  if (!existsSync(base)) return [];
  const dbs = readdirSync(base)
    .map((p) => join(base, p, "cookies.sqlite"))
    .filter((p) => existsSync(p));
  // default-release profiles are the everyday ones; try them first.
  return dbs.sort((a, b) => Number(b.includes("default-release")) - Number(a.includes("default-release")));
}

/**
 * Read the named cookies for a host substring from a Firefox cookie DB. Copies
 * the DB first (Firefox keeps it locked while open). Returns name→value.
 */
export async function readFirefoxCookies(
  hostLike: string,
  names: string[],
  opts: { dbPath?: string } = {},
): Promise<Map<string, string>> {
  const dbPath = opts.dbPath ?? firefoxCookieDbs()[0];
  if (!dbPath || !existsSync(dbPath)) throw new Error("no Firefox cookies.sqlite found");

  const tmp = join(process.env.TMPDIR ?? "/tmp", `leet-ff-cookies-${process.pid}.sqlite`);
  // Copy the DB (and its WAL sidecar, if present) so an open Firefox can't lock
  // us out and we see committed + not-yet-checkpointed rows.
  await Bun.spawn(["cp", dbPath, tmp]).exited;
  if (existsSync(`${dbPath}-wal`)) await Bun.spawn(["cp", `${dbPath}-wal`, `${tmp}-wal`]).exited;

  const result = new Map<string, string>();
  const db = new Database(tmp, { readonly: true });
  try {
    const placeholders = names.map(() => "?").join(",");
    const rows = db
      .query(
        `SELECT name, value FROM moz_cookies WHERE host LIKE ? AND name IN (${placeholders})`,
      )
      .all(`%${hostLike}%`, ...names) as { name: string; value: string }[];
    for (const row of rows) result.set(row.name, row.value);
  } finally {
    db.close();
    await Bun.spawn(["rm", "-f", tmp]).exited;
  }
  return result;
}
