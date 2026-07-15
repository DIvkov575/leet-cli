import { describe, expect, test, afterEach } from "bun:test";
import { assertOnline, isOffline, OfflineError, setConfigOffline } from "./net.ts";

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
  setConfigOffline(undefined);
});

describe("isOffline", () => {
  test("false by default", () => {
    delete process.env.LEET_OFFLINE;
    expect(isOffline()).toBe(false);
  });
  test("true when LEET_OFFLINE is a truthy value", () => {
    for (const v of ["1", "true", "yes", "on"]) {
      expect(isOffline({ LEET_OFFLINE: v } as any)).toBe(true);
    }
  });
  test("false for empty / 0 / false", () => {
    for (const v of ["", "0", "false", "False"]) {
      expect(isOffline({ LEET_OFFLINE: v } as any)).toBe(false);
    }
  });
  test("config flag also enables it", () => {
    delete process.env.LEET_OFFLINE;
    setConfigOffline(true);
    expect(isOffline()).toBe(true);
    setConfigOffline(false);
    expect(isOffline()).toBe(false);
  });
});

describe("assertOnline", () => {
  test("no-op when online", () => {
    delete process.env.LEET_OFFLINE;
    setConfigOffline(false);
    expect(() => assertOnline("fetch")).not.toThrow();
  });
  test("throws OfflineError when offline", () => {
    process.env.LEET_OFFLINE = "1";
    expect(() => assertOnline("fetch the statement")).toThrow(OfflineError);
    expect(() => assertOnline("fetch the statement")).toThrow(/offline mode is on/);
  });
});
