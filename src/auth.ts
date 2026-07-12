/**
 * Shared "grab the LeetCode session from a local browser" logic, used by both
 * the `leet auth` CLI command and the TUI's Sync menu. Tries Firefox (plaintext
 * cookie store) then Chrome (Keychain-decrypted); recent Chrome uses app-bound
 * encryption we can't read, reported honestly.
 */
import { readFirefoxCookies } from "./firefox-cookies.ts";
import { readChromeCookies } from "./chrome-cookies.ts";
import { verifySession } from "./leetcode-progress.ts";
import { loadConfig, saveConfig } from "./config.ts";

export interface AuthResult {
  username: string;
  from: string;
}

/**
 * Find a LeetCode session in a local browser, verify it, and save it to config.
 * Throws with a clear, multi-line message if none is found or it doesn't verify.
 * `sources` limits which browsers to try (default: firefox then chrome).
 */
export async function authFromBrowser(
  sources: Array<"firefox" | "chrome"> = ["firefox", "chrome"],
): Promise<AuthResult> {
  let found: { session: string; csrf?: string; from: string } | null = null;
  const notes: string[] = [];
  for (const src of sources) {
    try {
      const reader = src === "firefox" ? readFirefoxCookies : readChromeCookies;
      const c = await reader("leetcode.com", ["LEETCODE_SESSION", "csrftoken"]);
      const session = c.get("LEETCODE_SESSION");
      if (session) {
        found = { session, csrf: c.get("csrftoken"), from: src };
        break;
      }
      notes.push(`${src}: no LeetCode session (are you logged in there?)`);
    } catch (err) {
      notes.push(`${src}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!found) {
    throw new Error(
      "couldn't find a LeetCode session in a local browser:\n  " +
        notes.join("\n  ") +
        "\n\nLog into leetcode.com in Firefox or Chrome, then retry. " +
        "Or set LEETCODE_SESSION manually from devtools.",
    );
  }

  const username = await verifySession({ session: found.session, csrf: found.csrf });
  const cfg = await loadConfig();
  cfg.leetcodeSession = found.session;
  if (found.csrf) cfg.leetcodeCsrf = found.csrf;
  await saveConfig(cfg);
  return { username, from: found.from };
}
