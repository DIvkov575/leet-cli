import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndRun, resolveCompileFlags, SANITIZE_FLAGS } from "./runner.ts";

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

  // Regression: at -O2 with no debug info, undefined behavior (like falling
  // off the end of a value-returning function) used to crash with a bare
  // SIGTRAP/SIGABRT and empty stderr. ASan+UBSan turn that into a real
  // file:line diagnostic when the local compiler/runtime can execute sanitizer
  // binaries; on platforms where the sanitizer runtime itself aborts, the
  // runner falls back to plain C++17/-O2 so normal harnesses still run.
  test("undefined behavior uses sanitizers when available and never reports sanitizer bootstrap crashes", async () => {
    const path = setup(
      `int f() { for (int i = 0; i < 0; i++) return i; }\nint main(){ return f(); }\n`,
    );
    const r = await compileAndRun(path, cxx!);
    const flags = await resolveCompileFlags(cxx!);
    const hasSanitizers = SANITIZE_FLAGS.every((flag) => flags.includes(flag));
    rmSync(dir, { recursive: true, force: true });
    expect(r.compiled).toBe(true);
    if (hasSanitizers) {
      expect(r.ok).toBe(false);
      expect(r.log).toContain("runtime error");
      expect(r.log).toMatch(/:\d+:\d+/); // file:line:col of the actual UB site
    } else {
      expect(r.log).not.toContain("AddressSanitizer: CHECK failed");
    }
  });
});
