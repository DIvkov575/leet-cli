import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { pbkdf2Sync, createCipheriv } from "node:crypto";
import { decryptCookie, chromeProfileDbPaths } from "./chrome-cookies.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Reproduce Chrome's v10 macOS scheme to encrypt a value, then decrypt it back.
function encryptV10(plaintext: string, keychainPw: string): Buffer {
  const key = pbkdf2Sync(keychainPw, "saltysalt", 1003, 16, "sha1");
  const iv = Buffer.alloc(16, " ");
  const cipher = createCipheriv("aes-128-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("v10"), ct, tag]);
}

// The classic macOS scheme: AES-128-CBC, IV = 16 spaces, PKCS7 padding, with a
// 32-byte domain hash prepended to the plaintext (Chrome ≥ ~130). This is what
// real Chrome writes on macOS, and what the GCM-only path failed to read.
function encryptV10Cbc(plaintext: string, keychainPw: string, withDomainHash = true): Buffer {
  const key = pbkdf2Sync(keychainPw, "saltysalt", 1003, 16, "sha1");
  const iv = Buffer.alloc(16, " ");
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  const prefixed = withDomainHash
    ? Buffer.concat([Buffer.alloc(32, 0xab), Buffer.from(plaintext, "utf8")])
    : Buffer.from(plaintext, "utf8");
  const ct = Buffer.concat([cipher.update(prefixed), cipher.final()]);
  return Buffer.concat([Buffer.from("v10"), ct]);
}

const KEY = pbkdf2Sync("test-keychain-pw", "saltysalt", 1003, 16, "sha1");

describe("decryptCookie (Chrome v10 AES-GCM)", () => {
  test("round-trips a value encrypted with the same scheme", () => {
    const enc = encryptV10("session-token-abc123", "test-keychain-pw");
    expect(decryptCookie(enc, KEY)).toBe("session-token-abc123");
  });

  test("rejects a non-v10 prefix", () => {
    const bogus = Buffer.concat([Buffer.from("v11"), Buffer.alloc(20)]);
    expect(() => decryptCookie(bogus, KEY)).toThrow(/unsupported/i);
  });

  test("wrong key fails to decrypt", () => {
    const enc = encryptV10("secret", "test-keychain-pw");
    const wrong = pbkdf2Sync("other-pw", "saltysalt", 1003, 16, "sha1");
    expect(() => decryptCookie(enc, wrong)).toThrow();
  });
});

describe("decryptCookie (Chrome v10 AES-CBC — real macOS scheme)", () => {
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF-_123";

  test("round-trips a value and strips the 32-byte domain hash", () => {
    const enc = encryptV10Cbc(JWT, "test-keychain-pw");
    expect(decryptCookie(enc, KEY)).toBe(JWT);
  });

  test("decrypts CBC without a domain-hash prefix too", () => {
    const enc = encryptV10Cbc("plain-session", "test-keychain-pw", false);
    expect(decryptCookie(enc, KEY)).toBe("plain-session");
  });

  test("wrong key fails to decrypt a CBC value", () => {
    const enc = encryptV10Cbc(JWT, "test-keychain-pw");
    const wrong = pbkdf2Sync("other-pw", "saltysalt", 1003, 16, "sha1");
    expect(() => decryptCookie(enc, wrong)).toThrow();
  });
});

describe("chromeProfileDbPaths (multi-profile discovery)", () => {
  let root: string;

  const profile = (name: string, mtime?: Date) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "Cookies");
    writeFileSync(f, "x");
    return f;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "leet-chrome-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("finds Default and every numbered profile", () => {
    profile("Default");
    profile("Profile 1");
    profile("Profile 2");
    const found = chromeProfileDbPaths(root);
    expect(found).toHaveLength(3);
    expect(found.some((p) => p.includes("Profile 2"))).toBe(true);
    expect(found.some((p) => p.includes("Default"))).toBe(true);
  });

  test("a Chrome with no Default profile still yields its numbered ones", () => {
    // The real-world case that broke `leet auth`: the session lived in
    // "Profile 2" and Default did not exist at all.
    profile("Profile 2");
    const found = chromeProfileDbPaths(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Profile 2");
  });

  test("skips profile dirs with no Cookies db, and non-profile dirs", () => {
    profile("Default");
    mkdirSync(join(root, "Profile 9"), { recursive: true }); // no Cookies file
    mkdirSync(join(root, "ShaderCache"), { recursive: true });
    expect(chromeProfileDbPaths(root)).toHaveLength(1);
  });

  test("missing Chrome dir -> no paths (not a throw)", () => {
    expect(chromeProfileDbPaths(join(root, "nope"))).toEqual([]);
  });

  test("Guest Profile is ignored (never holds a real session)", () => {
    profile("Default");
    profile("Guest Profile");
    const found = chromeProfileDbPaths(root);
    expect(found.every((p) => !p.includes("Guest"))).toBe(true);
  });
});
