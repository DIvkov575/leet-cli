import { describe, expect, test } from "bun:test";
import { pbkdf2Sync, createCipheriv } from "node:crypto";
import { decryptCookie } from "./chrome-cookies.ts";

// Reproduce Chrome's v10 macOS scheme to encrypt a value, then decrypt it back.
function encryptV10(plaintext: string, keychainPw: string): Buffer {
  const key = pbkdf2Sync(keychainPw, "saltysalt", 1003, 16, "sha1");
  const iv = Buffer.alloc(16, " ");
  const cipher = createCipheriv("aes-128-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("v10"), ct, tag]);
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

  test("wrong key fails GCM authentication", () => {
    const enc = encryptV10("secret", "test-keychain-pw");
    const wrong = pbkdf2Sync("other-pw", "saltysalt", 1003, 16, "sha1");
    expect(() => decryptCookie(enc, wrong)).toThrow();
  });
});
