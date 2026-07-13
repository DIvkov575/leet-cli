/**
 * Read and decrypt cookies from Google Chrome's cookie store on macOS, so we can
 * grab the user's LeetCode session without them copying it out of devtools.
 *
 * Chrome encrypts each cookie value with AES-128-GCM (values are tagged "v10").
 * The key is PBKDF2-SHA1(keychainPassword, "saltysalt", 1003, 16), where the
 * keychain password is the "Chrome Safe Storage" generic-password entry. This is
 * the documented, widely-used scheme; it is macOS/Chrome-specific.
 */
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync, statSync, type Dirent } from "node:fs";
import { Database } from "bun:sqlite";

const SALT = "saltysalt";
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const IV = Buffer.alloc(16, " "); // 16 spaces
const GCM_TAG_LENGTH = 16;

/** Root of the Chrome user-data dir on macOS (holds one dir per profile). */
export function chromeUserDataDir(): string {
  return join(homedir(), "Library", "Application Support", "Google", "Chrome");
}

/** Default Chrome cookie DB path for the Default profile on macOS. */
export function chromeCookieDbPath(profile = "Default"): string {
  return join(chromeUserDataDir(), profile, "Cookies");
}

/**
 * Every Chrome profile's cookie DB, newest-first.
 *
 * Chrome only calls the first profile "Default"; subsequent ones are "Profile 1",
 * "Profile 2", … and a user whose only signed-in profile is "Profile 2" has no
 * Default dir at all. Looking solely at Default therefore reports "no session"
 * for people who are plainly logged in, so we search them all.
 *
 * Sorted by mtime descending, so the profile the user actually browses with is
 * tried first. "Guest Profile" and "System Profile" are skipped — they never hold
 * a durable login.
 */
export function chromeProfileDbPaths(root: string = chromeUserDataDir()): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // Chrome not installed / no user-data dir
  }
  const dbs: { path: string; mtime: number }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    const isProfile = name === "Default" || /^Profile \d+$/.test(name);
    if (!isProfile) continue;
    const db = join(root, name, "Cookies");
    try {
      dbs.push({ path: db, mtime: statSync(db).mtimeMs });
    } catch {
      // profile dir without a cookie DB — nothing to read
    }
  }
  return dbs.sort((a, b) => b.mtime - a.mtime).map((d) => d.path);
}

/** Read the "Chrome Safe Storage" password from the macOS login keychain. */
async function keychainPassword(): Promise<string> {
  const proc = Bun.spawn(
    ["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const pw = out.trim();
  if (code !== 0 || !pw) {
    throw new Error(
      "could not read the 'Chrome Safe Storage' key from your Keychain (denied or Chrome not installed)",
    );
  }
  return pw;
}

/** Derive the AES key Chrome uses for v10 cookies from the keychain password. */
function deriveKey(keychainPw: string): Buffer {
  return pbkdf2Sync(keychainPw, SALT, ITERATIONS, KEY_LENGTH, "sha1");
}

/**
 * Decrypt one Chrome-encrypted cookie value tagged "v10".
 *
 * Two "v10" schemes exist in the wild and Chrome does not distinguish them in
 * the stored prefix, so we try both:
 *  - AES-128-GCM (16-byte auth tag appended) — Linux/Windows and some builds.
 *  - AES-128-CBC (PKCS7 padding, IV = 16 spaces) — the classic macOS scheme,
 *    which current Chrome still writes on this platform.
 * Throws for any non-v10 prefix (older "v11"/DPAPI formats we don't cover) or
 * when neither mode decrypts (wrong key, or app-bound "v20" encryption).
 */
export function decryptCookie(encrypted: Buffer, key: Buffer): string {
  const prefix = encrypted.subarray(0, 3).toString("latin1");
  if (prefix !== "v10") {
    throw new Error(`unsupported Chrome cookie encryption "${prefix}" (expected v10 on macOS)`);
  }
  const payload = encrypted.subarray(3);

  // GCM first: it authenticates, so a success is unambiguous and a wrong key
  // fails cleanly rather than yielding garbage.
  try {
    const tag = payload.subarray(payload.length - GCM_TAG_LENGTH);
    const ciphertext = payload.subarray(0, payload.length - GCM_TAG_LENGTH);
    const decipher = createDecipheriv("aes-128-gcm", key, IV);
    decipher.setAuthTag(tag);
    return stripDomainHash(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    // Not GCM (or wrong key) — fall through to CBC.
  }

  const decipher = createDecipheriv("aes-128-cbc", key, IV);
  decipher.setAutoPadding(true);
  // Throws "bad decrypt" on a wrong key when the PKCS7 padding is invalid.
  const out = Buffer.concat([decipher.update(payload), decipher.final()]);
  return stripDomainHash(out);
}

/** Chrome ≥ v24 prefixes the plaintext with a 32-byte domain hash; drop it. */
function stripDomainHash(buf: Buffer): string {
  const full = buf.toString("utf8");
  // A LEETCODE_SESSION is a base64url JWT-like string; if the first 32 bytes are
  // non-printable garbage, they're the domain hash.
  if (/^[\x20-\x7e]+$/.test(full)) return full;
  return buf.subarray(32).toString("utf8");
}

export interface ChromeCookie {
  name: string;
  value: string;
}

/** Outcome of reading one profile's DB: what decrypted, and whether rows existed. */
interface DbReadResult {
  cookies: Map<string, string>;
  /** Matching rows found before decryption — distinguishes "no session" from "can't decrypt". */
  rowCount: number;
}

/** Read + decrypt the named cookies from a single Chrome cookie DB file. */
async function readOneChromeDb(
  dbPath: string,
  hostLike: string,
  names: string[],
  key: Buffer,
): Promise<DbReadResult> {
  // Copy so a running Chrome doesn't block the read (SQLite lock). Keyed by
  // pid+dbPath hash so concurrent profiles never clobber one temp file.
  const tag = `${process.pid}-${Bun.hash(dbPath).toString(36)}`;
  const tmp = join(process.env.TMPDIR ?? "/tmp", `leet-chrome-cookies-${tag}.sqlite`);
  await Bun.spawn(["cp", dbPath, tmp]).exited;

  const cookies = new Map<string, string>();
  let rowCount = 0;
  const db = new Database(tmp, { readonly: true });
  try {
    const placeholders = names.map(() => "?").join(",");
    const rows = db
      .query(
        `SELECT name, encrypted_value FROM cookies ` +
          `WHERE host_key LIKE ? AND name IN (${placeholders})`,
      )
      .all(`%${hostLike}%`, ...names) as { name: string; encrypted_value: Uint8Array }[];
    rowCount = rows.length;
    for (const row of rows) {
      try {
        cookies.set(row.name, decryptCookie(Buffer.from(row.encrypted_value), key));
      } catch {
        // skip undecryptable rows
      }
    }
  } finally {
    db.close();
    await Bun.spawn(["rm", "-f", tmp]).exited;
  }
  return { cookies, rowCount };
}

/**
 * Read + decrypt the named cookies for a host substring from Chrome. Searches
 * every profile (see {@link chromeProfileDbPaths}) unless a specific `dbPath` is
 * given, and returns the first profile that yields a decrypted cookie — so a
 * session in "Profile 2" is found even when "Default" is empty or absent.
 * Returns a name→value map; cookies that fail to decrypt are skipped.
 */
export async function readChromeCookies(
  hostLike: string,
  names: string[],
  opts: { dbPath?: string } = {},
): Promise<Map<string, string>> {
  const paths = opts.dbPath ? [opts.dbPath] : chromeProfileDbPaths();
  if (paths.length === 0) {
    throw new Error(`no Chrome cookie DB found under ${chromeUserDataDir()}`);
  }
  if (opts.dbPath && !(await Bun.file(opts.dbPath).exists())) {
    throw new Error(`Chrome cookie DB not found at ${opts.dbPath}`);
  }

  const key = deriveKey(await keychainPassword());
  let sawRows = false;
  for (const dbPath of paths) {
    if (!(await Bun.file(dbPath).exists())) continue;
    const { cookies, rowCount } = await readOneChromeDb(dbPath, hostLike, names, key);
    if (cookies.size > 0) return cookies; // first profile with a usable session wins
    if (rowCount > 0) sawRows = true;
  }

  // Rows existed somewhere but none decrypted → almost certainly Chrome's newer
  // app-bound encryption, which external tools can't read. Say so plainly.
  if (sawRows) {
    throw new Error(
      "found Chrome cookies but couldn't decrypt them — recent Chrome uses app-bound " +
        "encryption. Use Firefox, or copy the cookie manually from devtools.",
    );
  }
  return new Map();
}
