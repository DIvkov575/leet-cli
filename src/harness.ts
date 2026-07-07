/**
 * Generate a self-contained C++ test harness for a LeetCode problem from its
 * metaData (method name, param/return types) and the example test cases.
 *
 * Example inputs and expected outputs are parsed as JSON at generation time and
 * emitted as C++ literals, so the generated file needs no runtime JSON parser.
 * Signatures using types we can't emit (linked lists, trees, ...) are reported
 * as unsupported so the caller can fall back to a comment block.
 */

export interface MetaParam {
  name: string;
  type: string;
}

export interface ProblemMeta {
  /** Method to call on Solution, e.g. "twoSum". */
  name: string;
  params: MetaParam[];
  return: { type: string };
}

/** A single example case: raw JSON strings for each arg, and the expected output. */
export interface ExampleCase {
  args: string[];
  expected: string | null;
}

/** Map a LeetCode metaData type to a C++ type, or null if we can't emit it. */
export function cppType(leetType: string): string | null {
  const t = leetType.trim();
  const scalar: Record<string, string> = {
    integer: "int",
    long: "long long",
    double: "double",
    boolean: "bool",
    string: "string",
    character: "char",
    void: "void",
  };
  if (t in scalar) return scalar[t]!;
  if (t.endsWith("[]")) {
    const inner = cppType(t.slice(0, -2));
    return inner ? `vector<${inner}>` : null;
  }
  // LeetCode also uses `list<T>` (e.g. in return types) for array-like values.
  if (t.startsWith("list<") && t.endsWith(">")) {
    const inner = cppType(t.slice("list<".length, -1));
    return inner ? `vector<${inner}>` : null;
  }
  return null;
}

/** Convert a parsed JSON value into a C++ literal for the given cpp type. */
export function jsonToCppLiteral(value: unknown, type: string): string {
  if (type.startsWith("vector<")) {
    const inner = type.slice("vector<".length, -1);
    if (!Array.isArray(value)) throw new Error(`expected array for ${type}`);
    return `{${value.map((v) => jsonToCppLiteral(v, inner)).join(",")}}`;
  }
  switch (type) {
    case "int":
    case "long long":
    case "double":
      if (typeof value !== "number") throw new Error(`expected number for ${type}`);
      return String(value);
    case "bool":
      return value ? "true" : "false";
    case "string":
      if (typeof value !== "string") throw new Error("expected string");
      return JSON.stringify(value); // C++ and JSON string escaping agree for common cases
    case "char":
      if (typeof value !== "string" || value.length !== 1) throw new Error("expected char");
      return `'${value === "'" || value === "\\" ? "\\" + value : value}'`;
    default:
      throw new Error(`unsupported literal type ${type}`);
  }
}

/**
 * Split LeetCode's `exampleTestcases` (one JSON value per line) into groups of
 * `nParams` lines — one group per example case.
 */
export function parseExampleArgs(exampleTestcases: string, nParams: number): string[][] {
  if (nParams <= 0) return [];
  const lines = exampleTestcases.split("\n").filter((l) => l.trim() !== "");
  const groups: string[][] = [];
  for (let i = 0; i + nParams <= lines.length; i += nParams) {
    groups.push(lines.slice(i, i + nParams));
  }
  return groups;
}

/** Pull the `Output:` values out of the problem statement HTML, in order. */
export function parseExpectedOutputs(contentHtml: string): string[] {
  const out: string[] = [];
  const re = /<strong>Output:<\/strong>\s*([^\n<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contentHtml)) !== null) {
    out.push(m[1]!.trim());
  }
  return out;
}

/** Pair example inputs with expected outputs into ExampleCases. */
export function buildCases(
  exampleTestcases: string,
  contentHtml: string,
  nParams: number,
): ExampleCase[] {
  const argGroups = parseExampleArgs(exampleTestcases, nParams);
  const outputs = parseExpectedOutputs(contentHtml);
  return argGroups.map((args, i) => ({ args, expected: outputs[i] ?? null }));
}

export interface HarnessResult {
  supported: boolean;
  /** C++ source for the harness (main + helpers), present when supported. */
  code?: string;
  /** Why the harness could not be generated, present when unsupported. */
  reason?: string;
}

const HELPERS = `
template <typename T>
static void __show(ostream& os, const T& v) { os << v; }
static void __show(ostream& os, bool v) { os << (v ? "true" : "false"); }
static void __show(ostream& os, const string& v) { os << '"' << v << '"'; }
template <typename T>
static void __show(ostream& os, const vector<T>& v) {
  os << '[';
  for (size_t i = 0; i < v.size(); ++i) { if (i) os << ','; __show(os, v[i]); }
  os << ']';
}
template <typename T>
static string __str(const T& v) { ostringstream os; __show(os, v); return os.str(); }
`;

/**
 * Generate the `main()` harness that runs each example case against
 * `Solution().<method>(...)` and prints pass/fail.
 */
export function generateHarness(meta: ProblemMeta, cases: ExampleCase[]): HarnessResult {
  const paramTypes = meta.params.map((p) => cppType(p.type));
  const retType = cppType(meta.return.type);

  if (paramTypes.some((t) => t === null) || retType === null || retType === "void") {
    const bad = meta.params
      .filter((_, i) => paramTypes[i] === null)
      .map((p) => `${p.name}:${p.type}`);
    if (retType === null || retType === "void") bad.push(`return:${meta.return.type}`);
    return { supported: false, reason: `unsupported type(s): ${bad.join(", ")}` };
  }

  const usable = cases.filter((c) => c.args.length === meta.params.length);
  if (usable.length === 0) return { supported: false, reason: "no usable example cases" };

  const lines: string[] = [];
  lines.push(HELPERS.trimEnd());
  lines.push("");
  lines.push("int main() {");
  lines.push("  int __pass = 0, __total = 0;");

  usable.forEach((c, idx) => {
    let argExprs: string[];
    try {
      argExprs = c.args.map((raw, i) => jsonToCppLiteral(JSON.parse(raw), paramTypes[i]!));
    } catch {
      // Args we can't emit -> the case is unusable, skip it entirely.
      return;
    }
    // Expected output is best-effort: if it's missing or unparseable (some
    // statements format it oddly), still emit a "ran, got=..." case so the
    // problem is runnable rather than dropped.
    let expectedExpr: string | null = null;
    if (c.expected !== null) {
      try {
        expectedExpr = jsonToCppLiteral(JSON.parse(c.expected), retType);
      } catch {
        expectedExpr = null;
      }
    }
    const n = idx + 1;
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    // Materialize args as named locals: LeetCode signatures take non-const
    // references, which cannot bind to braced-initializer temporaries.
    const argNames = argExprs.map((expr, i) => {
      const name = `__a${i}`;
      lines.push(`    ${paramTypes[i]} ${name} = ${expr};`);
      return name;
    });
    lines.push(`    ${retType} __got = Solution().${meta.name}(${argNames.join(", ")});`);
    if (expectedExpr !== null) {
      lines.push(`    ${retType} __exp = ${expectedExpr};`);
      lines.push(`    bool __ok = (__got == __exp);`);
      lines.push(`    if (__ok) ++__pass;`);
      lines.push(
        `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
          ` << "  got=" << __str(__got) << (__ok ? "" : "  expected=" + __str(__exp)) << "\\n";`,
      );
    } else {
      lines.push(`    ++__pass;`);
      lines.push(`    cout << "case ${n}: ran   got=" << __str(__got) << "\\n";`);
    }
    lines.push(`  }`);
  });

  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return 0;");
  lines.push("}");
  return { supported: true, code: lines.join("\n") };
}
