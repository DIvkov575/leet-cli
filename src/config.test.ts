import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  saveConfig,
  resolveEditor,
  resolveSolutionsDir,
  resolveCxx,
  resolveLeetCodeAuth,
  CONFIG_FIELDS,
  toggleSelection,
  type Config,
} from "./config.ts";

let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leet-cfg-"));
  process.env.LEET_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

describe("loadConfig", () => {
  test("missing file -> empty config", async () => {
    expect(await loadConfig()).toEqual({});
  });

  test("round-trips through save", async () => {
    const cfg: Config = { editor: "code -w", solutionsDir: "sols", cxx: "g++" };
    await saveConfig(cfg);
    expect(await loadConfig()).toEqual(cfg);
  });

  test("garbage file -> empty config", async () => {
    await Bun.write(join(dir, "config.json"), "{ not json");
    expect(await loadConfig()).toEqual({});
  });

  test("ignores unknown keys and wrong types", async () => {
    await Bun.write(join(dir, "config.json"), JSON.stringify({ editor: 5, bogus: "x", cxx: "clang++" }));
    expect(await loadConfig()).toEqual({ cxx: "clang++" });
  });
});

describe("saveConfig drops empty values", () => {
  test("empty strings are not persisted", async () => {
    await saveConfig({ editor: "  ", solutionsDir: "out", cxx: "" });
    expect(await loadConfig()).toEqual({ solutionsDir: "out" });
  });
});

describe("resolveEditor: config > $VISUAL > $EDITOR > fallback", () => {
  test("config wins over env", () => {
    expect(resolveEditor({ editor: "micro" }, { VISUAL: "vim", EDITOR: "nano" })).toBe("micro");
  });
  test("falls back to $VISUAL then $EDITOR", () => {
    expect(resolveEditor({}, { VISUAL: "vim", EDITOR: "nano" })).toBe("vim");
    expect(resolveEditor({}, { EDITOR: "nano" })).toBe("nano");
  });
  test("no config or env -> undefined (caller picks installed default)", () => {
    expect(resolveEditor({}, {})).toBeUndefined();
  });
});

describe("resolveSolutionsDir: explicit flag > config > default", () => {
  test("explicit flag wins", () => {
    expect(resolveSolutionsDir("flagdir", { solutionsDir: "cfgdir" })).toBe("flagdir");
  });
  test("config used when no flag", () => {
    expect(resolveSolutionsDir(undefined, { solutionsDir: "cfgdir" })).toBe("cfgdir");
  });
  test("defaults to solutions", () => {
    expect(resolveSolutionsDir(undefined, {})).toBe("solutions");
  });
});

describe("resolveCxx: config > $CXX > default", () => {
  test("config wins", () => expect(resolveCxx({ cxx: "g++" }, { CXX: "clang++" })).toBe("g++"));
  test("env used when no config", () => expect(resolveCxx({}, { CXX: "clang++" })).toBe("clang++"));
  test("defaults to c++", () => expect(resolveCxx({}, {})).toBe("c++"));
});

describe("CONFIG_FIELDS metadata", () => {
  test("describes the editable settings (credentials excluded)", () => {
    expect(CONFIG_FIELDS.map((f) => f.key)).toEqual([
      "editor",
      "solutionsDir",
      "cxx",
      "recommend",
      "recommendExclude",
    ]);
    // The session cookie is a credential and must not be a TUI-editable field.
    expect(CONFIG_FIELDS.some((f) => f.key === "leetcodeSession")).toBe(false);
  });
});

describe("resolveLeetCodeAuth: env > config", () => {
  test("env session wins over config", () => {
    const auth = resolveLeetCodeAuth({ leetcodeSession: "cfg" }, { LEETCODE_SESSION: "env" });
    expect(auth?.session).toBe("env");
  });
  test("config session used when env unset", () => {
    expect(resolveLeetCodeAuth({ leetcodeSession: "cfg" }, {})?.session).toBe("cfg");
  });
  test("null when no session anywhere", () => {
    expect(resolveLeetCodeAuth({}, {})).toBeNull();
  });
  test("carries the csrf token", () => {
    expect(resolveLeetCodeAuth({}, { LEETCODE_SESSION: "s", LEETCODE_CSRF: "c" })?.csrf).toBe("c");
  });
});

describe("credential persists through save/load (hidden but stored)", () => {
  test("leetcodeSession round-trips", async () => {
    await saveConfig({ leetcodeSession: "abc123", editor: "vim" });
    const cfg = await loadConfig();
    expect(cfg.leetcodeSession).toBe("abc123");
    expect(cfg.editor).toBe("vim");
  });
});

describe("recommendExclude (list de-selection)", () => {
  test("round-trips as a string array", async () => {
    await saveConfig({ recommendExclude: ["citadel", "sig"] });
    expect((await loadConfig()).recommendExclude).toEqual(["citadel", "sig"]);
  });

  test("survives alongside the string settings", async () => {
    await saveConfig({ editor: "vim", recommendExclude: ["uber"] });
    const cfg = await loadConfig();
    expect(cfg.editor).toBe("vim");
    expect(cfg.recommendExclude).toEqual(["uber"]);
  });

  test("an empty selection is not persisted (file stays minimal)", async () => {
    await saveConfig({ editor: "vim", recommendExclude: [] });
    expect(await loadConfig()).toEqual({ editor: "vim" });
  });

  test("junk entries and wrong types are rejected", async () => {
    await Bun.write(
      join(dir, "config.json"),
      JSON.stringify({ recommendExclude: ["uber", 5, "", "  ", null, "sig"] }),
    );
    expect((await loadConfig()).recommendExclude).toEqual(["uber", "sig"]);

    await Bun.write(join(dir, "config.json"), JSON.stringify({ recommendExclude: "uber" }));
    expect((await loadConfig()).recommendExclude).toBeUndefined();
  });

  test("is a TUI-editable field, declared as a multiselect", () => {
    const field = CONFIG_FIELDS.find((f) => f.key === "recommendExclude");
    expect(field).toBeDefined();
    expect(field!.kind).toBe("multiselect");
  });

  test("every other field stays plain text", () => {
    for (const f of CONFIG_FIELDS) {
      if (f.key !== "recommendExclude") expect(f.kind).toBe("text");
    }
  });
});

describe("toggleSelection", () => {
  test("adds a name that isn't selected yet", () => {
    expect(toggleSelection(undefined, "uber")).toEqual(["uber"]);
    expect(toggleSelection(["citadel"], "uber")).toEqual(["citadel", "uber"]);
  });

  test("removes a name that is already selected", () => {
    expect(toggleSelection(["citadel", "uber"], "citadel")).toEqual(["uber"]);
    expect(toggleSelection(["uber"], "uber")).toEqual([]);
  });

  test("removal is case-insensitive (hand-edited config still toggles off)", () => {
    expect(toggleSelection(["Citadel"], "citadel")).toEqual([]);
    expect(toggleSelection([" sig "], "SIG")).toEqual([]);
  });

  test("never mutates the input", () => {
    const before = ["uber"];
    toggleSelection(before, "citadel");
    expect(before).toEqual(["uber"]);
  });

  test("toggling twice is a no-op", () => {
    const once = toggleSelection(["a"], "b");
    expect(toggleSelection(once, "b")).toEqual(["a"]);
  });
});
