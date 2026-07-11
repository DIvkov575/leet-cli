import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndRun } from "./runner.ts";

// These exercise a real c++ compiler; skip gracefully if none is installed.
const cxx = Bun.which("c++") ?? Bun.which("g++") ?? Bun.which("clang++");
const maybe = cxx ? describe : describe.skip;

maybe("compileAndRun", () => {
  let dir: string;
  const setup = (src: string): string => {
    dir = mkdtempSync(join(tmpdir(), "leet-run-"));
    const path = join(dir, "1-x.cpp");
    writeFileSync(path, src);
    return path;
  };

  test("passing harness → ok, exit 0, output captured", async () => {
    const path = setup(`#include <iostream>\nint main(){ std::cout << "case 1: PASS\\n"; return 0; }\n`);
    const r = await compileAndRun(path, cxx!);
    rmSync(dir, { recursive: true, force: true });
    expect(r.compiled).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.log).toContain("PASS");
  });

  test("failing harness → not ok, nonzero exit", async () => {
    const path = setup(`#include <iostream>\nint main(){ std::cerr << "case 1: FAIL\\n"; return 1; }\n`);
    const r = await compileAndRun(path, cxx!);
    rmSync(dir, { recursive: true, force: true });
    expect(r.compiled).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.log).toContain("FAIL");
  });

  test("compile error → compiled false, captures diagnostics", async () => {
    const path = setup(`int main(){ this is not c++ }\n`);
    const r = await compileAndRun(path, cxx!);
    rmSync(dir, { recursive: true, force: true });
    expect(r.compiled).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.log.length).toBeGreaterThan(0);
  });
});
