/**
 * Hand-written harness generators for the handful of bundled problems whose
 * shape doesn't fit generateHarness's generic "call Solution().method(args),
 * compare the return" model — a value-not-pointer locator param that must
 * find a real node inside an already-built structure, a cyclic list that
 * can't be JSON-serialized back for comparison, or a multi-method class
 * (Codec) rather than a single Solution method. Dispatched by slug from
 * resolveHarness in scaffold.ts, before generateHarness's generic path runs.
 */
import { buildCases, jsonToCppLiteral, type ExampleCase, type HarnessResult } from "./harness.ts";

/** Emit the shared helper block (once) plus a main() body built by `body`. */
function harness(helpers: string, mainBody: string): HarnessResult {
  return { supported: true, code: `${helpers.trim()}\n\nint main() {\n${mainBody}\n}` };
}

const SHOW_STR_HELPERS = `
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

const LISTNODE_BUILD_EQ_SHOW = `
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

const TREENODE_BUILD_EQ_SHOW = `
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

/**
 * `copy-list-with-random-pointer` and `populating-next-right-pointers-in-each-node-ii`
 * both use a `Node` type that metaData mislabels as `ListNode`/`TreeNode`,
 * but whose real shape is different — an extra `random` pointer, or an
 * extra `next` pointer alongside `left`/`right`. Real (compilable) struct
 * text for each, injected by scaffold.ts the same way NODE_STRUCTS is,
 * whenever the corresponding slug is one of these two.
 */
export const CUSTOM_NODE_STRUCTS: Record<string, string> = {
  "copy-list-with-random-pointer": [
    "class Node {",
    "public:",
    "    int val;",
    "    Node* next;",
    "    Node* random;",
    "    Node(int _val) {",
    "        val = _val;",
    "        next = NULL;",
    "        random = NULL;",
    "    }",
    "};",
  ].join("\n"),
  "populating-next-right-pointers-in-each-node-ii": [
    "class Node {",
    "public:",
    "    int val;",
    "    Node* left;",
    "    Node* right;",
    "    Node* next;",
    "    Node() : val(0), left(NULL), right(NULL), next(NULL) {}",
    "    Node(int _val) : val(_val), left(NULL), right(NULL), next(NULL) {}",
    "    Node(int _val, Node* _left, Node* _right, Node* _next)",
    "        : val(_val), left(_left), right(_right), next(_next) {}",
    "};",
  ].join("\n"),
};

/**
 * Helpers for copy-list-with-random-pointer's Node{val,next,random}: build
 * from LeetCode's [[val,randomIndex],...] encoding (two passes — link
 * `next` first, then wire `random` by index since a random pointer can
 * point forward), compare both the value chain and the random-index chain
 * structurally, and print back the same [[val,randomIndex],...] form.
 */
const RANDOM_LIST_BUILD_EQ_SHOW = `
static Node* __buildRandomList(const vector<int>& vals, const vector<int>& randomIdx) {
  vector<Node*> nodes(vals.size());
  for (size_t i = 0; i < vals.size(); ++i) nodes[i] = new Node(vals[i]);
  for (size_t i = 0; i + 1 < nodes.size(); ++i) nodes[i]->next = nodes[i + 1];
  for (size_t i = 0; i < nodes.size(); ++i) if (randomIdx[i] >= 0) nodes[i]->random = nodes[randomIdx[i]];
  return nodes.empty() ? nullptr : nodes[0];
}
static vector<Node*> __flattenRandomList(Node* head) {
  vector<Node*> nodes;
  for (Node* n = head; n; n = n->next) nodes.push_back(n);
  return nodes;
}
static bool __eqRandomList(Node* a, Node* b) {
  vector<Node*> na = __flattenRandomList(a), nb = __flattenRandomList(b);
  if (na.size() != nb.size()) return false;
  unordered_map<Node*, int> idxA, idxB;
  for (size_t i = 0; i < na.size(); ++i) idxA[na[i]] = (int)i;
  for (size_t i = 0; i < nb.size(); ++i) idxB[nb[i]] = (int)i;
  for (size_t i = 0; i < na.size(); ++i) {
    if (na[i]->val != nb[i]->val) return false;
    int ra = na[i]->random ? idxA[na[i]->random] : -1;
    int rb = nb[i]->random ? idxB[nb[i]->random] : -1;
    if (ra != rb) return false;
  }
  return true;
}
static void __showRandomList(ostream& os, Node* head) {
  vector<Node*> nodes = __flattenRandomList(head);
  unordered_map<Node*, int> idx;
  for (size_t i = 0; i < nodes.size(); ++i) idx[nodes[i]] = (int)i;
  os << '[';
  for (size_t i = 0; i < nodes.size(); ++i) {
    if (i) os << ',';
    os << '[' << nodes[i]->val << ',';
    if (nodes[i]->random) os << idx[nodes[i]->random]; else os << "null";
    os << ']';
  }
  os << ']';
}
`;

/**
 * Helpers for populating-next-right-pointers-in-each-node-ii's
 * Node{val,left,right,next}: build the binary-tree shape (left/right) from
 * LeetCode's level-order array — `next` starts null, since it's the
 * solution's job to fill it in — and print/compare via the level-order form
 * with '#' markers at each level boundary (matching LeetCode's own "Output:
 * [1,#,2,3,#,4,5,7,#]" convention, which only makes sense if next pointers
 * are followed correctly).
 */
const NEXT_POINTER_TREE_BUILD_EQ_SHOW = `
static Node* __buildNextPointerTree(const vector<optional<int>>& v) {
  if (v.empty() || !v[0]) return nullptr;
  Node* root = new Node(*v[0]);
  queue<Node*> q; q.push(root);
  size_t i = 1;
  while (i < v.size() && !q.empty()) {
    Node* node = q.front(); q.pop();
    if (i < v.size()) { if (v[i]) { node->left = new Node(*v[i]); q.push(node->left); } ++i; }
    if (i < v.size()) { if (v[i]) { node->right = new Node(*v[i]); q.push(node->right); } ++i; }
  }
  return root;
}
static vector<optional<int>> __levelOrderWithNext(Node* root) {
  vector<optional<int>> out;
  Node* levelStart = root;
  while (levelStart) {
    Node* n = levelStart;
    while (n) { out.push_back(n->val); n = n->next; }
    out.push_back(nullopt); // '#' marks the end of this level
    Node* next = levelStart;
    while (next && !next->left && !next->right) next = next->next;
    levelStart = next ? (next->left ? next->left : next->right) : nullptr;
  }
  return out;
}
static void __showNextPointerTree(ostream& os, Node* root) {
  vector<optional<int>> out = __levelOrderWithNext(root);
  os << '[';
  for (size_t i = 0; i < out.size(); ++i) { if (i) os << ','; if (out[i]) os << *out[i]; else os << "#"; }
  os << ']';
}
`;

/** Find the ListNode with the given value by walking from head, or nullptr. */
const FIND_LISTNODE_BY_VAL = `
static ListNode* __findListNodeByVal(ListNode* head, int val) {
  for (ListNode* n = head; n; n = n->next) if (n->val == val) return n;
  return nullptr;
}
`;

/** Find the TreeNode with the given value via BFS, or nullptr. */
const FIND_TREENODE_BY_VAL = `
static TreeNode* __findTreeNodeByVal(TreeNode* root, int val) {
  queue<TreeNode*> q; if (root) q.push(root);
  while (!q.empty()) {
    TreeNode* n = q.front(); q.pop();
    if (n->val == val) return n;
    if (n->left) q.push(n->left);
    if (n->right) q.push(n->right);
  }
  return nullptr;
}
`;

/** Build a list, then (if pos >= 0) wire the tail's next to the node at that index — a cycle. */
const BUILD_LIST_WITH_CYCLE = `
static ListNode* __buildListWithCycle(const vector<int>& v, int pos) {
  ListNode* head = __buildList(v);
  if (pos < 0) return head;
  ListNode* cycleEntry = head;
  for (int i = 0; i < pos; i++) cycleEntry = cycleEntry->next;
  ListNode* tail = head;
  while (tail && tail->next) tail = tail->next;
  if (tail) tail->next = cycleEntry;
  return head;
}
`;

/**
 * Emits a harness for `serialize-and-deserialize-binary-tree`'s shape: a
 * multi-method `class Codec` (serialize/deserialize), used per LeetCode's
 * own usage comment as `Codec ser, deser; deser.deserialize(ser.serialize(root))`.
 * generateHarness's `Solution().method(...)` model doesn't apply at all here.
 */
function serializeDeserializeBinaryTree(cases: ExampleCase[]): HarnessResult {
  const lines: string[] = ["  int __pass = 0, __total = 0;"];
  cases.forEach((c, idx) => {
    const n = idx + 1;
    let rootExpr: string;
    try {
      rootExpr = jsonToCppLiteral(JSON.parse(c.args[0]!), "TreeNode*");
    } catch {
      return;
    }
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    lines.push(`    TreeNode* __root = ${rootExpr};`);
    lines.push(`    Codec __ser, __deser;`);
    lines.push(`    TreeNode* __got = __deser.deserialize(__ser.serialize(__root));`);
    lines.push(`    bool __ok = __eq(__got, __root);`);
    lines.push(`    if (__ok) ++__pass;`);
    lines.push(
      `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
        ` << "  got=" << __str(__got) << (__ok ? "" : "  expected=" + __str(__root)) << "\\n";`,
    );
    lines.push(`  }`);
  });
  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return __pass == __total ? 0 : 1;");
  return harness(SHOW_STR_HELPERS + TREENODE_BUILD_EQ_SHOW, lines.join("\n"));
}

/** Best-effort int parse of a raw JSON arg; null on failure. */
function parseIntArg(raw: string): number | null {
  try {
    const v = JSON.parse(raw);
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * `linked-list-cycle`'s shape: metaData declares `head`/`pos`, but the real
 * signature is `hasCycle(ListNode* head)` — `pos` wires a cycle into the
 * built list (LeetCode's own judge does this; it's not passed as an arg).
 * Expected output ("true"/"false") parses fine as a normal boolean.
 */
function linkedListCycle(cases: ExampleCase[]): HarnessResult {
  const lines: string[] = ["  int __pass = 0, __total = 0;"];
  cases.forEach((c, idx) => {
    const list = (() => {
      try {
        return jsonToCppLiteral(JSON.parse(c.args[0]!), "vector<int>");
      } catch {
        return null;
      }
    })();
    const pos = parseIntArg(c.args[1]!);
    const expected = c.expected === "true" || c.expected === "false" ? c.expected : null;
    if (list === null || pos === null || expected === null) return;
    const n = idx + 1;
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    lines.push(`    ListNode* __a0 = __buildListWithCycle(${list}, ${pos});`);
    lines.push(`    bool __got = Solution().hasCycle(__a0);`);
    lines.push(`    bool __exp = ${expected};`);
    lines.push(`    bool __ok = (__got == __exp);`);
    lines.push(`    if (__ok) ++__pass;`);
    lines.push(
      `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
        ` << "  got=" << __str(__got) << (__ok ? "" : "  expected=" + __str(__exp)) << "\\n";`,
    );
    lines.push(`  }`);
  });
  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return __pass == __total ? 0 : 1;");
  return harness(SHOW_STR_HELPERS + LISTNODE_BUILD_EQ_SHOW + BUILD_LIST_WITH_CYCLE, lines.join("\n"));
}

/**
 * `linked-list-cycle-ii`'s shape: same pos-wired-cycle input as
 * linked-list-cycle, but returns the ListNode* where the cycle begins (or
 * nullptr). A cyclic list can't be serialized back for a structural
 * comparison, but the correct answer is derivable directly from the input
 * we built — it must be the exact node object at index `pos` (or nullptr if
 * pos < 0) — so this compares by pointer identity rather than parsing
 * LeetCode's free-text "Output: tail connects to node index N" statement.
 */
function linkedListCycleII(cases: ExampleCase[]): HarnessResult {
  const lines: string[] = ["  int __pass = 0, __total = 0;"];
  cases.forEach((c, idx) => {
    const list = (() => {
      try {
        return jsonToCppLiteral(JSON.parse(c.args[0]!), "vector<int>");
      } catch {
        return null;
      }
    })();
    const pos = parseIntArg(c.args[1]!);
    if (list === null || pos === null) return;
    const n = idx + 1;
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    lines.push(`    vector<int> __v0 = ${list};`);
    lines.push(`    ListNode* __a0 = __buildListWithCycle(__v0, ${pos});`);
    lines.push(`    ListNode* __expNode = nullptr;`);
    lines.push(`    if (${pos} >= 0) { __expNode = __a0; for (int i = 0; i < ${pos}; i++) __expNode = __expNode->next; }`);
    lines.push(`    ListNode* __got = Solution().detectCycle(__a0);`);
    lines.push(`    bool __ok = (__got == __expNode);`);
    lines.push(`    if (__ok) ++__pass;`);
    lines.push(
      `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
        ` << "  got=" << (__got ? to_string(__got->val) : "null")` +
        ` << (__ok ? "" : "  expected=" + string(__expNode ? to_string(__expNode->val) : "null")) << "\\n";`,
    );
    lines.push(`  }`);
  });
  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return __pass == __total ? 0 : 1;");
  return harness(SHOW_STR_HELPERS + LISTNODE_BUILD_EQ_SHOW + BUILD_LIST_WITH_CYCLE, lines.join("\n"));
}

/**
 * `delete-node-in-a-linked-list`'s shape: metaData declares `head`/`node`,
 * but the real signature is `deleteNode(ListNode* node)` — `node` is the
 * *value* of the node to pass (found by walking the built list), not a
 * second real parameter. deleteNode mutates in place with no return, so the
 * check re-inspects the original `head` after the call.
 */
function deleteNodeInALinkedList(cases: ExampleCase[]): HarnessResult {
  const lines: string[] = ["  int __pass = 0, __total = 0;"];
  cases.forEach((c, idx) => {
    const list = (() => {
      try {
        return jsonToCppLiteral(JSON.parse(c.args[0]!), "vector<int>");
      } catch {
        return null;
      }
    })();
    const nodeVal = parseIntArg(c.args[1]!);
    const expList = c.expected
      ? (() => {
          try {
            return jsonToCppLiteral(JSON.parse(c.expected!), "vector<int>");
          } catch {
            return null;
          }
        })()
      : null;
    if (list === null || nodeVal === null || expList === null) return;
    const n = idx + 1;
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    lines.push(`    ListNode* __a0 = __buildList(${list});`);
    lines.push(`    ListNode* __target = __findListNodeByVal(__a0, ${nodeVal});`);
    lines.push(`    Solution().deleteNode(__target);`);
    lines.push(`    ListNode* __exp = __buildList(${expList});`);
    lines.push(`    bool __ok = __eq(__a0, __exp);`);
    lines.push(`    if (__ok) ++__pass;`);
    lines.push(
      `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
        ` << "  got=" << __str(__a0) << (__ok ? "" : "  expected=" + __str(__exp)) << "\\n";`,
    );
    lines.push(`  }`);
  });
  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return __pass == __total ? 0 : 1;");
  return harness(SHOW_STR_HELPERS + LISTNODE_BUILD_EQ_SHOW + FIND_LISTNODE_BY_VAL, lines.join("\n"));
}

/**
 * `all-nodes-distance-k-in-binary-tree`'s shape: metaData declares `target`
 * as `integer`, but the real signature takes `TreeNode* target` — LeetCode's
 * judge looks up the node with that value inside the already-built tree and
 * passes the pointer. The statement allows the returned array in any order,
 * so the check sorts both sides before comparing.
 */
function allNodesDistanceKInBinaryTree(cases: ExampleCase[]): HarnessResult {
  const lines: string[] = ["  int __pass = 0, __total = 0;"];
  cases.forEach((c, idx) => {
    const tree = (() => {
      try {
        return jsonToCppLiteral(JSON.parse(c.args[0]!), "TreeNode*");
      } catch {
        return null;
      }
    })();
    const targetVal = parseIntArg(c.args[1]!);
    const k = parseIntArg(c.args[2]!);
    const expArr = c.expected
      ? (() => {
          try {
            return jsonToCppLiteral(JSON.parse(c.expected!), "vector<int>");
          } catch {
            return null;
          }
        })()
      : null;
    if (tree === null || targetVal === null || k === null || expArr === null) return;
    const n = idx + 1;
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    lines.push(`    TreeNode* __a0 = ${tree};`);
    lines.push(`    TreeNode* __target = __findTreeNodeByVal(__a0, ${targetVal});`);
    lines.push(`    vector<int> __got = Solution().distanceK(__a0, __target, ${k});`);
    lines.push(`    vector<int> __exp = ${expArr};`);
    lines.push(`    vector<int> __gotSorted = __got, __expSorted = __exp;`);
    lines.push(`    sort(__gotSorted.begin(), __gotSorted.end());`);
    lines.push(`    sort(__expSorted.begin(), __expSorted.end());`);
    lines.push(`    bool __ok = (__gotSorted == __expSorted);`);
    lines.push(`    if (__ok) ++__pass;`);
    lines.push(
      `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
        ` << "  got=" << __str(__got) << (__ok ? "" : "  expected=" + __str(__exp)) << "\\n";`,
    );
    lines.push(`  }`);
  });
  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return __pass == __total ? 0 : 1;");
  return harness(SHOW_STR_HELPERS + TREENODE_BUILD_EQ_SHOW + FIND_TREENODE_BY_VAL, lines.join("\n"));
}

/**
 * `lowest-common-ancestor-of-a-binary-search-tree`'s shape: metaData
 * declares `p`/`q` as `integer`, but the real signature takes `TreeNode* p,
 * TreeNode* q` — found by value inside the built tree, same as distanceK's
 * `target`. The returned node is compared by value (LeetCode's own example
 * output is just the LCA's value, e.g. "6"), not full-subtree equality.
 */
function lowestCommonAncestorOfABST(cases: ExampleCase[]): HarnessResult {
  const lines: string[] = ["  int __pass = 0, __total = 0;"];
  cases.forEach((c, idx) => {
    const tree = (() => {
      try {
        return jsonToCppLiteral(JSON.parse(c.args[0]!), "TreeNode*");
      } catch {
        return null;
      }
    })();
    const pVal = parseIntArg(c.args[1]!);
    const qVal = parseIntArg(c.args[2]!);
    const expVal = c.expected !== null ? parseIntArg(c.expected) : null;
    if (tree === null || pVal === null || qVal === null || expVal === null) return;
    const n = idx + 1;
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    lines.push(`    TreeNode* __a0 = ${tree};`);
    lines.push(`    TreeNode* __p = __findTreeNodeByVal(__a0, ${pVal});`);
    lines.push(`    TreeNode* __q = __findTreeNodeByVal(__a0, ${qVal});`);
    lines.push(`    TreeNode* __got = Solution().lowestCommonAncestor(__a0, __p, __q);`);
    lines.push(`    int __exp = ${expVal};`);
    lines.push(`    bool __ok = (__got && __got->val == __exp);`);
    lines.push(`    if (__ok) ++__pass;`);
    lines.push(
      `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
        ` << "  got=" << (__got ? to_string(__got->val) : "null") << (__ok ? "" : "  expected=" + to_string(__exp)) << "\\n";`,
    );
    lines.push(`  }`);
  });
  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return __pass == __total ? 0 : 1;");
  return harness(SHOW_STR_HELPERS + TREENODE_BUILD_EQ_SHOW + FIND_TREENODE_BY_VAL, lines.join("\n"));
}

/**
 * `copy-list-with-random-pointer`'s shape: metaData reports `head`/return
 * as `ListNode`, but the real struct is a custom `Node{val,next,random}`.
 * Input/output are each encoded as `[[val,randomIndex],...]`, not a plain
 * int array — parsed and rebuilt via `__buildRandomList`.
 */
function copyListWithRandomPointer(cases: ExampleCase[]): HarnessResult {
  const lines: string[] = ["  int __pass = 0, __total = 0;"];
  cases.forEach((c, idx) => {
    const parsed = (() => {
      try {
        const raw = JSON.parse(c.args[0]!) as Array<[number, number | null]>;
        if (!Array.isArray(raw)) return null;
        return raw;
      } catch {
        return null;
      }
    })();
    const expParsed = c.expected
      ? (() => {
          try {
            const raw = JSON.parse(c.expected!) as Array<[number, number | null]>;
            if (!Array.isArray(raw)) return null;
            return raw;
          } catch {
            return null;
          }
        })()
      : null;
    if (parsed === null || expParsed === null) return;
    const n = idx + 1;
    const vals = `{${parsed.map(([v]) => v).join(",")}}`;
    const randIdx = `{${parsed.map(([, r]) => (r === null ? -1 : r)).join(",")}}`;
    const expVals = `{${expParsed.map(([v]) => v).join(",")}}`;
    const expRandIdx = `{${expParsed.map(([, r]) => (r === null ? -1 : r)).join(",")}}`;
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    lines.push(`    vector<int> __vals0 = ${vals}, __rand0 = ${randIdx};`);
    lines.push(`    Node* __a0 = __buildRandomList(__vals0, __rand0);`);
    lines.push(`    Node* __got = Solution().copyRandomList(__a0);`);
    lines.push(`    vector<int> __valsExp = ${expVals}, __randExp = ${expRandIdx};`);
    lines.push(`    Node* __exp = __buildRandomList(__valsExp, __randExp);`);
    // A correct solution must return a deep copy, not the same nodes/list.
    lines.push(`    bool __ok = __eqRandomList(__got, __exp) && __got != __a0;`);
    lines.push(`    if (__ok) ++__pass;`);
    lines.push(`    ostringstream __os; __showRandomList(__os, __got);`);
    lines.push(`    ostringstream __osExp; __showRandomList(__osExp, __exp);`);
    lines.push(
      `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL")` +
        ` << "  got=" << __os.str() << (__ok ? "" : "  expected=" + __osExp.str()) << "\\n";`,
    );
    lines.push(`  }`);
  });
  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return __pass == __total ? 0 : 1;");
  return harness(SHOW_STR_HELPERS + RANDOM_LIST_BUILD_EQ_SHOW, lines.join("\n"));
}

/**
 * `populating-next-right-pointers-in-each-node-ii`'s shape: metaData
 * reports `root`/return as `TreeNode`, but the real struct is a custom
 * `Node{val,left,right,next}`. The solution mutates `next` in place and
 * also returns `root`, so the check calls the method and inspects `root`'s
 * next-pointer level-order form (LeetCode's own '#'-per-level convention).
 */
function populatingNextRightPointersII(cases: ExampleCase[]): HarnessResult {
  const lines: string[] = ["  int __pass = 0, __total = 0;"];
  cases.forEach((c, idx) => {
    const treeVals = (() => {
      try {
        const arr = JSON.parse(c.args[0]!) as Array<number | null>;
        if (!Array.isArray(arr)) return null;
        return `{${arr.map((v) => (v === null ? "nullopt" : v)).join(",")}}`;
      } catch {
        return null;
      }
    })();
    // Expected is LeetCode's own next-pointer level-order form (with '#'
    // markers), which the harness computes structurally rather than parsing.
    if (treeVals === null) return;
    const n = idx + 1;
    lines.push(`  {`);
    lines.push(`    ++__total;`);
    lines.push(`    Node* __a0 = __buildNextPointerTree(${treeVals});`);
    lines.push(`    Node* __got = Solution().connect(__a0);`);
    // The connect() call is expected to wire next-pointers correctly; the
    // reference "expected" shape is the same tree with no level connected
    // (i.e. compare against a freshly-linked correct traversal) — so build
    // the check from first principles: BFS by left/right, and require each
    // node's `next` to be the following node in that BFS order (or null at
    // the end of a level).
    lines.push(`    bool __ok = true;`);
    lines.push(`    { vector<Node*> __level = {__got}; while (!__level.empty() && __ok) {`);
    lines.push(`      vector<Node*> __nextLevel;`);
    lines.push(`      for (size_t i = 0; i < __level.size(); ++i) {`);
    lines.push(`        Node* __expNext = (i + 1 < __level.size()) ? __level[i + 1] : nullptr;`);
    lines.push(`        if (__level[i]->next != __expNext) { __ok = false; break; }`);
    lines.push(`        if (__level[i]->left) __nextLevel.push_back(__level[i]->left);`);
    lines.push(`        if (__level[i]->right) __nextLevel.push_back(__level[i]->right);`);
    lines.push(`      }`);
    lines.push(`      __level = __nextLevel;`);
    lines.push(`    } }`);
    lines.push(`    if (__ok) ++__pass;`);
    lines.push(`    ostringstream __os; __showNextPointerTree(__os, __got);`);
    lines.push(
      `    cout << "case ${n}: " << (__ok ? "PASS" : "FAIL") << "  got=" << __os.str() << "\\n";`,
    );
    lines.push(`  }`);
  });
  lines.push(`  cout << __pass << "/" << __total << " passed\\n";`);
  lines.push("  return __pass == __total ? 0 : 1;");
  return harness(SHOW_STR_HELPERS + NEXT_POINTER_TREE_BUILD_EQ_SHOW, lines.join("\n"));
}

/** Slugs this module has a hand-written generator for. */
export const CUSTOM_HARNESS_SLUGS: ReadonlySet<string> = new Set([
  "serialize-and-deserialize-binary-tree",
  "copy-list-with-random-pointer",
  "populating-next-right-pointers-in-each-node-ii",
  "linked-list-cycle",
  "linked-list-cycle-ii",
  "delete-node-in-a-linked-list",
  "all-nodes-distance-k-in-binary-tree",
  "lowest-common-ancestor-of-a-binary-search-tree",
]);

/**
 * Generate a hand-written harness for one of the slugs in
 * `CUSTOM_HARNESS_SLUGS`, or null if the exampleTestcases don't parse into
 * usable cases (caller falls back to reporting unsupported).
 */
export function generateCustomHarness(
  slug: string,
  exampleTestcases: string,
  contentHtml: string,
): HarnessResult | null {
  switch (slug) {
    case "serialize-and-deserialize-binary-tree": {
      const cases = buildCases(exampleTestcases, contentHtml, 1);
      if (cases.length === 0) return null;
      return serializeDeserializeBinaryTree(cases);
    }
    case "copy-list-with-random-pointer": {
      const cases = buildCases(exampleTestcases, contentHtml, 1);
      if (cases.length === 0) return null;
      return copyListWithRandomPointer(cases);
    }
    case "populating-next-right-pointers-in-each-node-ii": {
      const cases = buildCases(exampleTestcases, contentHtml, 1);
      if (cases.length === 0) return null;
      return populatingNextRightPointersII(cases);
    }
    case "linked-list-cycle": {
      const cases = buildCases(exampleTestcases, contentHtml, 2);
      if (cases.length === 0) return null;
      return linkedListCycle(cases);
    }
    case "linked-list-cycle-ii": {
      const cases = buildCases(exampleTestcases, contentHtml, 2);
      if (cases.length === 0) return null;
      return linkedListCycleII(cases);
    }
    case "delete-node-in-a-linked-list": {
      const cases = buildCases(exampleTestcases, contentHtml, 2);
      if (cases.length === 0) return null;
      return deleteNodeInALinkedList(cases);
    }
    case "all-nodes-distance-k-in-binary-tree": {
      const cases = buildCases(exampleTestcases, contentHtml, 3);
      if (cases.length === 0) return null;
      return allNodesDistanceKInBinaryTree(cases);
    }
    case "lowest-common-ancestor-of-a-binary-search-tree": {
      const cases = buildCases(exampleTestcases, contentHtml, 3);
      if (cases.length === 0) return null;
      return lowestCommonAncestorOfABST(cases);
    }
    default:
      return null;
  }
}
