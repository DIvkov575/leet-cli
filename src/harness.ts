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

/** LeetCode node types this harness can build/compare (see NODE_HELPERS below). */
const NODE_TYPES = ["ListNode", "TreeNode"] as const;
type NodeType = (typeof NODE_TYPES)[number];

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
  if ((NODE_TYPES as readonly string[]).includes(t)) return `${t}*`;
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

/** True when a cpp type is exactly the pointer form of a node type, e.g. "ListNode*". */
function nodeTypeOf(cppT: string): NodeType | null {
  for (const n of NODE_TYPES) if (cppT === `${n}*`) return n;
  return null;
}

/** True when a cpp type is or contains (via vector<...>) a node pointer type. */
function usesNodeType(cppT: string): boolean {
  if (nodeTypeOf(cppT)) return true;
  if (cppT.startsWith("vector<")) return usesNodeType(cppT.slice("vector<".length, -1));
  return false;
}

/** Convert a parsed JSON value into a C++ literal for the given cpp type. */
export function jsonToCppLiteral(value: unknown, type: string): string {
  if (type.startsWith("vector<")) {
    const inner = type.slice("vector<".length, -1);
    if (!Array.isArray(value)) throw new Error(`expected array for ${type}`);
    return `{${value.map((v) => jsonToCppLiteral(v, inner)).join(",")}}`;
  }
  const node = nodeTypeOf(type);
  if (node === "ListNode") {
    if (!Array.isArray(value)) throw new Error("expected array for ListNode*");
    return `__buildList({${value.map((v) => jsonToCppLiteral(v, "int")).join(",")}})`;
  }
  if (node === "TreeNode") {
    if (!Array.isArray(value)) throw new Error("expected array for TreeNode*");
    const items = value.map((v) => (v === null ? "nullopt" : jsonToCppLiteral(v, "int")));
    return `__buildTree({${items.join(",")}})`;
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
// Elementwise structural comparison for a vector of node pointers (e.g.
// vector<ListNode*>/vector<TreeNode*> returns), dispatching to that node
// type's own __eq overload per element rather than pointer identity.
template <typename T>
static bool __eq(const vector<T>& a, const vector<T>& b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) if (!__eq(a[i], b[i])) return false;
  return true;
}
`;

/** Helpers for ListNode: build from a flat array, compare structurally, print. */
const LISTNODE_HELPERS = `
static ListNode* __buildList(const vector<int>& v) {
  ListNode* head = nullptr; ListNode* tail = nullptr;
  for (int x : v) {
    ListNode* node = new ListNode(x);
    if (!tail) head = tail = node; else { tail->next = node; tail = node; }
  }
  return head;
}
static bool __eq(ListNode* a, ListNode* b) {
  while (a && b) { if (a->val != b->val) return false; a = a->next; b = b->next; }
  return a == nullptr && b == nullptr;
}
static void __show(ostream& os, ListNode* v) {
  os << '[';
  for (ListNode* n = v; n; n = n->next) { if (n != v) os << ','; os << n->val; }
  os << ']';
}
`;

/**
 * Helpers for TreeNode: build from a level-order array (LeetCode serialization
 * — nullopt marks a missing child), compare structurally, print back the same
 * level-order form.
 */
const TREENODE_HELPERS = `
static TreeNode* __buildTree(const vector<optional<int>>& v) {
  if (v.empty() || !v[0]) return nullptr;
  TreeNode* root = new TreeNode(*v[0]);
  queue<TreeNode*> q; q.push(root);
  size_t i = 1;
  while (i < v.size() && !q.empty()) {
    TreeNode* node = q.front(); q.pop();
    if (i < v.size()) { if (v[i]) { node->left = new TreeNode(*v[i]); q.push(node->left); } ++i; }
    if (i < v.size()) { if (v[i]) { node->right = new TreeNode(*v[i]); q.push(node->right); } ++i; }
  }
  return root;
}
static bool __eq(TreeNode* a, TreeNode* b) {
  if (!a || !b) return a == b;
  return a->val == b->val && __eq(a->left, b->left) && __eq(a->right, b->right);
}
static void __show(ostream& os, TreeNode* v) {
  vector<optional<int>> out;
  queue<TreeNode*> q; if (v) q.push(v);
  while (!q.empty()) {
    TreeNode* n = q.front(); q.pop();
    if (!n) { out.push_back(nullopt); continue; }
    out.push_back(n->val); q.push(n->left); q.push(n->right);
  }
  while (!out.empty() && !out.back()) out.pop_back();
  os << '[';
  for (size_t i = 0; i < out.size(); ++i) { if (i) os << ','; if (out[i]) os << *out[i]; else os << "null"; }
  os << ']';
}
`;

/** Node-type helper blocks (builder/compare/show) actually used by a signature. */
function nodeHelpersFor(types: NodeType[]): string {
  const blocks: string[] = [];
  if (types.includes("ListNode")) blocks.push(LISTNODE_HELPERS.trim());
  if (types.includes("TreeNode")) blocks.push(TREENODE_HELPERS.trim());
  return blocks.join("\n\n");
}

/**
 * Generate the `main()` harness that runs each example case against
 * `Solution().<method>(...)` and prints pass/fail.
 */
export function generateHarness(meta: ProblemMeta, cases: ExampleCase[]): HarnessResult {
  const paramTypes = meta.params.map((p) => cppType(p.type));
  const retType = cppType(meta.return.type);
  // void is only observable via a mutated parameter — the first one, by
  // convention (the value LeetCode's own examples show as "Output:" for
  // these in-place-mutation problems). With no parameters there's nothing to
  // observe at all.
  const isVoid = retType === "void";
  const voidObservable = isVoid && meta.params.length > 0;

  if (paramTypes.some((t) => t === null) || retType === null || (isVoid && !voidObservable)) {
    const bad = meta.params
      .filter((_, i) => paramTypes[i] === null)
      .map((p) => `${p.name}:${p.type}`);
    if (retType === null || (isVoid && !voidObservable)) bad.push(`return:${meta.return.type}`);
    return { supported: false, reason: `unsupported type(s): ${bad.join(", ")}` };
  }

  // A vector<TreeNode*> return (e.g. all-possible-full-binary-trees,
  // delete-nodes-and-return-forest) is accepted by LeetCode's judge in any
  // order; a strict ordered-vector comparison would fail correct solutions
  // that happen to produce the trees in a different order, so this is left
  // unsupported rather than silently wrong.
  if (retType === "vector<TreeNode*>") {
    return {
      supported: false,
      reason: "list<TreeNode> return is order-independent on LeetCode's judge — a positional comparison would be unreliable",
    };
  }

  const usable = cases.filter((c) => c.args.length === meta.params.length);
  if (usable.length === 0) return { supported: false, reason: "no usable example cases" };

  // Which node builder/compare/show helpers this signature needs, in NODE_TYPES order.
  const allTypes = [...paramTypes, retType].filter((t): t is string => t !== null);
  const neededNodeTypes = NODE_TYPES.filter((n) => allTypes.some((t) => t.includes(n)));

  const lines: string[] = [];
  lines.push(HELPERS.trimEnd());
  const nodeHelpers = nodeHelpersFor(neededNodeTypes);
  if (nodeHelpers) {
    lines.push("");
    lines.push(nodeHelpers);
  }
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
    // problem is runnable rather than dropped. Void problems compare the
    // first param's post-call value, since there's no return to check.
    const observedType = voidObservable ? paramTypes[0]! : retType;
    let expectedExpr: string | null = null;
    if (c.expected !== null) {
      try {
        expectedExpr = jsonToCppLiteral(JSON.parse(c.expected), observedType);
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
    const call = `Solution().${meta.name}(${argNames.join(", ")})`;
    const gotExpr = voidObservable ? argNames[0]! : "__got";
    if (voidObservable) {
      lines.push(`    ${call};`);
    } else {
      lines.push(`    ${retType} __got = ${call};`);
    }
    if (expectedExpr !== null) {
      lines.push(`    ${observedType} __exp = ${expectedExpr};`);
      const cmp = usesNodeType(observedType)
        ? `__eq(${gotExpr}, __exp)`
        : `(${gotExpr} == __exp)`;
      lines.push(`    bool __ok = ${cmp};`);
      lines.push(`    if (__ok) ++__pass;`);
      lines.push(
        `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
          ` << "  got=" << __str(${gotExpr}) << (__ok ? "" : "  expected=" + __str(__exp)) << "\\n";`,
      );
    } else {
      lines.push(`    ++__pass;`);
      lines.push(`    cout << "case ${n}: ran   got=" << __str(${gotExpr}) << "\\n";`);
    }
    lines.push(`  }`);
  });

  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  // Non-zero exit when a checked case failed, so `leet test` / CI can detect it.
  lines.push("  return __pass == __total ? 0 : 1;");
  lines.push("}");
  return { supported: true, code: lines.join("\n") };
}
