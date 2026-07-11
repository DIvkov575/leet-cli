/**
 * Compile and run a scaffolded C++ solution, capturing all output as text.
 * Shared by `leet test` (streams to the terminal) and the TUI's Logs panel
 * (which shows the captured lines). Kept transport-agnostic: it returns the
 * combined log rather than inheriting stdio, so callers choose how to present it.
 */

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
 * Compile `<path>` with `cxx` (C++17, -O2) into a sibling `.out`, then run it.
 * Captures compiler diagnostics and the harness's own output into `log`.
 */
export async function compileAndRun(path: string, cxx: string): Promise<RunResult> {
  const bin = `${path.replace(/\.cpp$/, "")}.out`;
  let log = "";

  const compile = Bun.spawn([cxx, "-std=c++17", "-O2", path, "-o", bin], {
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
