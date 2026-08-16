/**
 * Compile and run a scaffolded C++ solution, capturing all output as text.
 * Shared by `leet test` (streams to the terminal) and the TUI's Logs panel
 * (which shows the captured lines). Kept transport-agnostic: it returns the
 * combined log rather than inheriting stdio, so callers choose how to present it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


export interface RunResult {
  /** True if compilation succeeded. */
  compiled: boolean;
  /** Process exit code of the test binary (null if it never ran). */
  exitCode: number | null;
  /** Combined compile + run output (stdout+stderr), line-oriented. */
  log: string;
  /** True when compiled and the harness exited 0 (all cases passed). */
  ok: boolean;
}

/**
 * Compiled with ASan+UBSan (see `compileAndRun`): at -O2 with no debug info,
 * undefined behavior (e.g. a missing `return`, an out-of-bounds access) often
 * crashes with a bare SIGTRAP/SIGABRT and no message — nothing for us to
 * capture. These flags trade a bit of compile/run time for an actual
 * file:line diagnostic when that happens.
 */
export const SANITIZE_FLAGS = ["-g", "-fsanitize=address,undefined", "-fno-omit-frame-pointer"];

const BASE_COMPILE_FLAGS = ["-std=c++17", "-O2"];
const sanitizerSupport = new Map<string, Promise<boolean>>();

async function compilerSupportsSanitizers(cxx: string): Promise<boolean> {
  const cached = sanitizerSupport.get(cxx);
  if (cached) return cached;

  const probe = (async () => {
    const dir = mkdtempSync(join(tmpdir(), "leet-sanitize-"));
    const src = join(dir, "smoke.cpp");
    const bin = join(dir, "smoke.out");
    try {
      writeFileSync(src, '#include <iostream>\nint main(){ std::cout << "leet sanitizer smoke\\n"; return 0; }\n');
      const compile = Bun.spawn([cxx, ...BASE_COMPILE_FLAGS, ...SANITIZE_FLAGS, src, "-o", bin], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((await compile.exited) !== 0) return false;

      const run = Bun.spawn([bin], { stdout: "pipe", stderr: "pipe" });
      const [out, code] = await Promise.all([new Response(run.stdout).text(), run.exited]);
      return code === 0 && out.includes("leet sanitizer smoke");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();

  sanitizerSupport.set(cxx, probe);
  return probe;
}

export async function resolveCompileFlags(cxx: string): Promise<string[]> {
  return (await compilerSupportsSanitizers(cxx))
    ? [...BASE_COMPILE_FLAGS, ...SANITIZE_FLAGS]
    : [...BASE_COMPILE_FLAGS];
}

/**
 * Compile `<path>` with `cxx` (C++17, -O2, and ASan+UBSan when the local
 * compiler/runtime can execute them), then run it. Captures compiler diagnostics
 * and the harness's own output into `log`.
 */
export async function compileAndRun(path: string, cxx: string): Promise<RunResult> {
  const bin = `${path.replace(/\.cpp$/, "")}.out`;
  let log = "";

  const compile = Bun.spawn([cxx, ...(await resolveCompileFlags(cxx)), path, "-o", bin], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [cOut, cErr, cCode] = await Promise.all([
    new Response(compile.stdout).text(),
    new Response(compile.stderr).text(),
    compile.exited,
  ]);
  log += cOut + cErr;
  if (cCode !== 0) {
    return { compiled: false, exitCode: null, log: log.trimEnd(), ok: false };
  }

  const run = Bun.spawn([bin], { stdout: "pipe", stderr: "pipe" });
  const [rOut, rErr, rCode] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  log += rOut + rErr;
  return { compiled: true, exitCode: rCode, log: log.trimEnd(), ok: rCode === 0 };
}
