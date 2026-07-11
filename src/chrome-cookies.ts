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
import { Database } from "bun:sqlite";

const SALT = "saltysalt";
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const IV = Buffer.alloc(16, " "); // 16 spaces
const GCM_TAG_LENGTH = 16;

/** Default Chrome cookie DB path for the Default profile on macOS. */
export function chromeCookieDbPath(profile = "Default"): string {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    profile,
    "Cookies",
  );
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
 * Decrypt one Chrome-encrypted cookie value. Handles the "v10" AES-GCM scheme;
 * throws for anything else (e.g. older "v11" DPAPI/Linux formats we don't cover).
 */
export function decryptCookie(encrypted: Buffer, key: Buffer): string {
  const prefix = encrypted.subarray(0, 3).toString("latin1");
  if (prefix !== "v10") {
    throw new Error(`unsupported Chrome cookie encryption "${prefix}" (expected v10 on macOS)`);
  }
  const payload = encrypted.subarray(3);
  const tag = payload.subarray(payload.length - GCM_TAG_LENGTH);
  const ciphertext = payload.subarray(0, payload.length - GCM_TAG_LENGTH);
  const decipher = createDecipheriv("aes-128-gcm", key, IV);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  // Older Chrome builds prepend a 32-byte SHA-256 domain hash to the plaintext;
  // strip it if the result isn't printable from the start.
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

/**
 * Read + decrypt the named cookies for a host substring from Chrome. Copies the
 * DB first (Chrome keeps it locked while running). Returns a name→value map;
 * cookies that fail to decrypt are skipped.
 */
export async function readChromeCookies(
  hostLike: string,
  names: string[],
  opts: { dbPath?: string } = {},
): Promise<Map<string, string>> {
  const dbPath = opts.dbPath ?? chromeCookieDbPath();
  if (!(await Bun.file(dbPath).exists())) {
    throw new Error(`Chrome cookie DB not found at ${dbPath}`);
  }
  // Copy so a running Chrome doesn't block the read (SQLite lock).
  const tmp = join(process.env.TMPDIR ?? "/tmp", `leet-chrome-cookies-${process.pid}.sqlite`);
  await Bun.spawn(["cp", dbPath, tmp]).exited;

  const key = deriveKey(await keychainPassword());
  const result = new Map<string, string>();
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
        result.set(row.name, decryptCookie(Buffer.from(row.encrypted_value), key));
      } catch {
        // skip undecryptable rows
      }
    }
  } finally {
    db.close();
    await Bun.spawn(["rm", "-f", tmp]).exited;
  }
  // Cookies exist but none decrypted → almost certainly Chrome's newer app-bound
  // encryption, which external tools can't read. Say so plainly.
  if (rowCount > 0 && result.size === 0) {
    throw new Error(
      "found Chrome cookies but couldn't decrypt them — recent Chrome uses app-bound " +
        "encryption. Use Firefox, or copy the cookie manually from devtools.",
    );
  }
  return result;
}
