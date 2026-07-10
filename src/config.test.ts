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
  CONFIG_FIELDS,
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
  test("describes the editable settings", () => {
    expect(CONFIG_FIELDS.map((f) => f.key)).toEqual(["editor", "solutionsDir", "cxx", "recommend"]);
  });
});
