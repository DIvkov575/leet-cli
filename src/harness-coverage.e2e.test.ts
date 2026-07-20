/**
 * End-to-end verification that scaffoldContent's output for every previously
 * gap-covered problem shape (void-return, ListNode, TreeNode,
 * vector<ListNode*>, order-independent vector<TreeNode*>, and the 8
 * custom-harness-dispatched shapes in custom-harness.ts) actually compiles
 * and runs with a real C++ toolchain — the unit tests in
 * harness.test.ts/scaffold.test.ts/custom-harness.test.ts check the
 * generated *text*, this checks it *executes correctly*.
 *
 * Mirrors runner.test.ts: skips entirely when no C++ compiler is on PATH.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldContent, type ScaffoldInput } from "./scaffold.ts";
import { compileAndRun } from "./runner.ts";

const cxx = Bun.which("c++") ?? Bun.which("g++") ?? Bun.which("clang++");
const maybe = cxx ? describe : describe.skip;

/**
 * Splice a solution body into scaffoldContent's output between the stub's
 * class braces — works for any class name (`class Solution`, `class Codec`,
 * ...) since the test fixtures cover both shapes. Throws instead of silently
 * returning the input unchanged on a non-match, so a fixture/regex mismatch
 * fails the test loudly rather than passing for the wrong reason (an
 * unspliced empty-body file would still compile and "ran" some cases).
 */
function withSolutionBody(content: string, solutionBody: string): string {
  const pattern = /(class \w+ \{\npublic:\n[^\n]*\{\n)( *)\n(\s*\}\n\};)/;
  if (!pattern.test(content)) {
    throw new Error(`withSolutionBody: no match for pattern in:\n${content}`);
  }
  return content.replace(
    pattern,
    (_m, open: string, _indent: string, close: string) => `${open}${solutionBody}\n${close}`,
  );
}

/**
 * Splice a full multi-method class body (everything after `public:` up to
 * the class's closing `};`) — for multi-method classes like `Codec`, where
 * `withSolutionBody`'s single-method-body regex doesn't apply. Throws on no
 * match, same rationale as `withSolutionBody`.
 */
function withFullClassBody(content: string, classBody: string): string {
  const pattern = /(class \w+ \{\npublic:\n)([\s\S]*?\n)(\};)/;
  if (!pattern.test(content)) {
    throw new Error(`withFullClassBody: no match for pattern in:\n${content}`);
  }
  return content.replace(pattern, (_m, open: string, _oldBody: string, close: string) => `${open}${classBody}\n${close}`);
}

/** Write scaffoldContent's output to a temp .cpp and compile+run it (needs a harness's main()). */
async function scaffoldAndRun(input: ScaffoldInput, solutionBody: string) {
  const content = withSolutionBody(scaffoldContent(input), solutionBody);
  const dir = mkdtempSync(join(tmpdir(), "leet-harness-e2e-"));
  const path = join(dir, `${input.id}-${input.slug}.cpp`);
  await Bun.write(path, content);
  const result = await compileAndRun(path, cxx!);
  rmSync(dir, { recursive: true, force: true });
  return { content, result };
}

/** Same as scaffoldAndRun, but for a multi-method class (see withFullClassBody). */
async function scaffoldAndRunFullClass(input: ScaffoldInput, classBody: string) {
  const content = withFullClassBody(scaffoldContent(input), classBody);
  const dir = mkdtempSync(join(tmpdir(), "leet-harness-e2e-"));
  const path = join(dir, `${input.id}-${input.slug}.cpp`);
  await Bun.write(path, content);
  const result = await compileAndRun(path, cxx!);
  rmSync(dir, { recursive: true, force: true });
  return { content, result };
}

maybe("harness coverage — fixable problems compile and run correctly", () => {
  test("sort-colors (vector void-return): correct solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 75,
        title: "Sort Colors",
        slug: "sort-colors",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/sort-colors/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    void sortColors(vector<int>& nums) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "sortColors",
          params: [{ name: "nums", type: "integer[]" }],
          return: { type: "void" },
        }),
        exampleTestcases: "[2,0,2,1,1,0]\n[2,0,1]",
        contentHtml: "<strong>Output:</strong> [0,0,1,1,2,2]\n<strong>Output:</strong> [0,1,2]\n",
      },
      `int lo = 0, mid = 0, hi = (int)nums.size() - 1;
    while (mid <= hi) {
      if (nums[mid] == 0) swap(nums[lo++], nums[mid++]);
      else if (nums[mid] == 1) mid++;
      else swap(nums[mid], nums[hi--]);
    }`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("2/2 passed");
  });

  test("sort-colors: incorrect solution correctly fails", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 75,
        title: "Sort Colors",
        slug: "sort-colors",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/sort-colors/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    void sortColors(vector<int>& nums) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "sortColors",
          params: [{ name: "nums", type: "integer[]" }],
          return: { type: "void" },
        }),
        exampleTestcases: "[2,0,2,1,1,0]",
        contentHtml: "<strong>Output:</strong> [0,0,1,1,2,2]\n",
      },
      "// intentionally does nothing — leaves nums unsorted",
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.log).toContain("FAIL");
  });

  test("rotate-image (2D vector void-return): correct solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 48,
        title: "Rotate Image",
        slug: "rotate-image",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/rotate-image/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    void rotate(vector<vector<int>>& matrix) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "rotate",
          params: [{ name: "matrix", type: "integer[][]" }],
          return: { type: "void" },
        }),
        exampleTestcases: "[[1,2,3],[4,5,6],[7,8,9]]",
        contentHtml: "<strong>Output:</strong> [[7,4,1],[8,5,2],[9,6,3]]\n",
      },
      `int n = (int)matrix.size();
    for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) swap(matrix[i][j], matrix[j][i]);
    for (auto& row : matrix) reverse(row.begin(), row.end());`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("add-two-numbers (ListNode params + return): correct solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 2,
        title: "Add Two Numbers",
        slug: "add-two-numbers",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/add-two-numbers/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    ListNode* addTwoNumbers(ListNode* l1, ListNode* l2) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "addTwoNumbers",
          params: [
            { name: "l1", type: "ListNode" },
            { name: "l2", type: "ListNode" },
          ],
          return: { type: "ListNode" },
        }),
        exampleTestcases: "[2,4,3]\n[5,6,4]",
        contentHtml: "<strong>Output:</strong> [7,0,8]\n",
      },
      `ListNode* dummy = new ListNode(0);
    ListNode* cur = dummy;
    int carry = 0;
    while (l1 || l2 || carry) {
      int sum = carry + (l1 ? l1->val : 0) + (l2 ? l2->val : 0);
      carry = sum / 10;
      cur->next = new ListNode(sum % 10);
      cur = cur->next;
      if (l1) l1 = l1->next;
      if (l2) l2 = l2->next;
    }
    return dummy->next;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("merge-two-sorted-lists: incorrect solution correctly fails structural compare", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 21,
        title: "Merge Two Sorted Lists",
        slug: "merge-two-sorted-lists",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/merge-two-sorted-lists/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    ListNode* mergeTwoLists(ListNode* list1, ListNode* list2) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "mergeTwoLists",
          params: [
            { name: "list1", type: "ListNode" },
            { name: "list2", type: "ListNode" },
          ],
          return: { type: "ListNode" },
        }),
        exampleTestcases: "[1,2,4]\n[1,3,4]",
        contentHtml: "<strong>Output:</strong> [1,1,2,3,4,4]\n",
      },
      "return list1; // wrong: ignores list2 entirely",
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.log).toContain("FAIL");
  });

  test("invert-binary-tree (TreeNode param + return): correct solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 226,
        title: "Invert Binary Tree",
        slug: "invert-binary-tree",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/invert-binary-tree/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    TreeNode* invertTree(TreeNode* root) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "invertTree",
          params: [{ name: "root", type: "TreeNode" }],
          return: { type: "TreeNode" },
        }),
        exampleTestcases: "[4,2,7,1,3,6,9]",
        contentHtml: "<strong>Output:</strong> [4,7,2,9,6,3,1]\n",
      },
      `if (!root) return nullptr;
    TreeNode* l = invertTree(root->left);
    TreeNode* r = invertTree(root->right);
    root->left = r; root->right = l;
    return root;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("flatten-binary-tree-to-linked-list (void + TreeNode param): correct solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 114,
        title: "Flatten Binary Tree to Linked List",
        slug: "flatten-binary-tree-to-linked-list",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/flatten-binary-tree-to-linked-list/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    void flatten(TreeNode* root) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "flatten",
          params: [{ name: "root", type: "TreeNode" }],
          return: { type: "void" },
        }),
        exampleTestcases: "[1,2,5,3,4,null,6]",
        contentHtml: "<strong>Output:</strong> [1,null,2,null,3,null,4,null,5,null,6]\n",
      },
      `if (!root) return;
    flatten(root->left);
    flatten(root->right);
    TreeNode* left = root->left;
    TreeNode* right = root->right;
    root->left = nullptr;
    root->right = left;
    TreeNode* cur = root;
    while (cur->right) cur = cur->right;
    cur->right = right;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("merge-k-sorted-lists (vector<ListNode*> param): correct solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 23,
        title: "Merge k Sorted Lists",
        slug: "merge-k-sorted-lists",
        difficulty: "Hard",
        url: "https://leetcode.com/problems/merge-k-sorted-lists/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    ListNode* mergeKLists(vector<ListNode*>& lists) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "mergeKLists",
          params: [{ name: "lists", type: "ListNode[]" }],
          return: { type: "ListNode" },
        }),
        exampleTestcases: "[[1,4,5],[1,3,4],[2,6]]",
        contentHtml: "<strong>Output:</strong> [1,1,2,3,4,4,5,6]\n",
      },
      `vector<int> vals;
    for (auto* l : lists) for (auto* n = l; n; n = n->next) vals.push_back(n->val);
    sort(vals.begin(), vals.end());
    ListNode* dummy = new ListNode(0);
    ListNode* cur = dummy;
    for (int v : vals) { cur->next = new ListNode(v); cur = cur->next; }
    return dummy->next;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("all-possible-full-binary-trees (vector<TreeNode*> return, order-independent): correct solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 894,
        title: "All Possible Full Binary Trees",
        slug: "all-possible-full-binary-trees",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/all-possible-full-binary-trees/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    vector<TreeNode*> allPossibleFBT(int n) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "allPossibleFBT",
          params: [{ name: "n", type: "integer" }],
          return: { type: "list<TreeNode>" },
        }),
        exampleTestcases: "3",
        contentHtml: "<strong>Output:</strong> [[0,0,0]]\n",
      },
      `if (n % 2 == 0) return {};
    if (n == 1) return { new TreeNode(0) };
    vector<TreeNode*> result;
    for (int left = 1; left < n; left += 2) {
      int right = n - 1 - left;
      for (auto* l : allPossibleFBT(left)) {
        for (auto* r : allPossibleFBT(right)) {
          result.push_back(new TreeNode(0, l, r));
        }
      }
    }
    return result;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("delete-nodes-and-return-forest (TreeNode param + vector<TreeNode*> return): correct solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 1110,
        title: "Delete Nodes And Return Forest",
        slug: "delete-nodes-and-return-forest",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/delete-nodes-and-return-forest/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    vector<TreeNode*> delNodes(TreeNode* root, vector<int>& to_delete) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "delNodes",
          params: [
            { name: "root", type: "TreeNode" },
            { name: "to_delete", type: "integer[]" },
          ],
          return: { type: "list<TreeNode>" },
        }),
        exampleTestcases: "[1,2,3,4,5,6,7]\n[3,5]",
        contentHtml: "<strong>Output:</strong> [[1,2,null,4],[6],[7]]\n",
      },
      `unordered_set<int> del(to_delete.begin(), to_delete.end());
    vector<TreeNode*> result;
    dfs(root, true, del, result);
    return result;
  }
  TreeNode* dfs(TreeNode* node, bool isRoot, unordered_set<int>& del, vector<TreeNode*>& result) {
    if (!node) return nullptr;
    bool deleted = del.count(node->val) > 0;
    if (isRoot && !deleted) result.push_back(node);
    node->left = dfs(node->left, deleted, del, result);
    node->right = dfs(node->right, deleted, del, result);
    return deleted ? nullptr : node;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });
});

maybe("harness coverage — custom-harness-dispatched shapes (custom-harness.ts)", () => {
  test("linked-list-cycle: correct Floyd's-algorithm solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 141,
        title: "Linked List Cycle",
        slug: "linked-list-cycle",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/linked-list-cycle/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    bool hasCycle(ListNode *head) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "hasCycle",
          params: [
            { name: "head", type: "ListNode" },
            { name: "pos", type: "integer" },
          ],
          return: { type: "boolean" },
        }),
        exampleTestcases: "[3,2,0,-4]\n1\n[1]\n-1",
        contentHtml: "<strong>Output:</strong> true\n<strong>Output:</strong> false\n",
      },
      `ListNode* slow = head, *fast = head;
    while (fast && fast->next) {
      slow = slow->next; fast = fast->next->next;
      if (slow == fast) return true;
    }
    return false;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("2/2 passed");
  });

  test("linked-list-cycle-ii: correct cycle-start-detection solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 142,
        title: "Linked List Cycle II",
        slug: "linked-list-cycle-ii",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/linked-list-cycle-ii/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    ListNode *detectCycle(ListNode *head) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "detectCycle",
          params: [
            { name: "head", type: "ListNode" },
            { name: "pos", type: "integer" },
          ],
          return: { type: "ListNode" },
        }),
        exampleTestcases: "[3,2,0,-4]\n1",
        contentHtml: "<strong>Output:</strong> tail connects to node index 1\n",
      },
      `ListNode* slow = head, *fast = head;
    while (fast && fast->next) {
      slow = slow->next; fast = fast->next->next;
      if (slow == fast) {
        ListNode* p = head;
        while (p != slow) { p = p->next; slow = slow->next; }
        return p;
      }
    }
    return nullptr;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("delete-node-in-a-linked-list: correct value-swap solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 237,
        title: "Delete Node in a Linked List",
        slug: "delete-node-in-a-linked-list",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/delete-node-in-a-linked-list/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    void deleteNode(ListNode* node) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "deleteNode",
          params: [
            { name: "head", type: "ListNode" },
            { name: "node", type: "integer" },
          ],
          return: { type: "void" },
        }),
        exampleTestcases: "[4,5,1,9]\n5",
        contentHtml: "<strong>Output:</strong> [4,1,9]\n",
      },
      `node->val = node->next->val;
    node->next = node->next->next;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("all-nodes-distance-k-in-binary-tree: correct BFS-from-target solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 863,
        title: "All Nodes Distance K in Binary Tree",
        slug: "all-nodes-distance-k-in-binary-tree",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/all-nodes-distance-k-in-binary-tree/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    vector<int> distanceK(TreeNode* root, TreeNode* target, int k) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "distanceK",
          params: [
            { name: "root", type: "TreeNode" },
            { name: "target", type: "integer" },
            { name: "k", type: "integer" },
          ],
          return: { type: "list<integer>" },
        }),
        exampleTestcases: "[3,5,1,6,2,0,8,null,null,7,4]\n5\n2",
        contentHtml: "<strong>Output:</strong> [7,4,1]\n",
      },
      `unordered_map<TreeNode*, TreeNode*> parent;
    stack<pair<TreeNode*, TreeNode*>> st;
    st.push({root, nullptr});
    while (!st.empty()) {
      auto [node, par] = st.top(); st.pop();
      if (!node) continue;
      parent[node] = par;
      st.push({node->left, node});
      st.push({node->right, node});
    }
    unordered_set<TreeNode*> visited;
    queue<TreeNode*> q;
    q.push(target); visited.insert(target);
    int dist = 0;
    while (!q.empty()) {
      if (dist == k) {
        vector<int> result;
        while (!q.empty()) { result.push_back(q.front()->val); q.pop(); }
        return result;
      }
      int sz = q.size();
      for (int i = 0; i < sz; i++) {
        TreeNode* n = q.front(); q.pop();
        for (TreeNode* nb : {n->left, n->right, parent[n]}) {
          if (nb && !visited.count(nb)) { visited.insert(nb); q.push(nb); }
        }
      }
      dist++;
    }
    return {};`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("lowest-common-ancestor-of-a-binary-search-tree: correct BST-property solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 235,
        title: "Lowest Common Ancestor of a Binary Search Tree",
        slug: "lowest-common-ancestor-of-a-binary-search-tree",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-search-tree/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: "class Solution {\npublic:\n    TreeNode* lowestCommonAncestor(TreeNode* root, TreeNode* p, TreeNode* q) {\n        \n    }\n};",
          },
        ],
        metaData: JSON.stringify({
          name: "lowestCommonAncestor",
          params: [
            { name: "root", type: "TreeNode" },
            { name: "p", type: "integer" },
            { name: "q", type: "integer" },
          ],
          return: { type: "TreeNode" },
        }),
        exampleTestcases: "[6,2,8,0,4,7,9,null,null,3,5]\n2\n8",
        contentHtml: "<strong>Output:</strong> 6\n",
      },
      `TreeNode* node = root;
    while (node) {
      if (p->val < node->val && q->val < node->val) node = node->left;
      else if (p->val > node->val && q->val > node->val) node = node->right;
      else return node;
    }
    return nullptr;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("copy-list-with-random-pointer: correct deep-copy solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 138,
        title: "Copy List with Random Pointer",
        slug: "copy-list-with-random-pointer",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/copy-list-with-random-pointer/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: [
              "/*",
              "// Definition for a Node.",
              "class Node {",
              "public:",
              "    int val;",
              "    Node* next;",
              "    Node* random;",
              "    Node(int _val) { val = _val; next = NULL; random = NULL; }",
              "};",
              "*/",
              "class Solution {",
              "public:",
              "    Node* copyRandomList(Node* head) {",
              "        ",
              "    }",
              "};",
            ].join("\n"),
          },
        ],
        metaData: JSON.stringify({
          name: "copyRandomList",
          params: [{ name: "head", type: "ListNode" }],
          return: { type: "ListNode" },
        }),
        exampleTestcases: "[[7,null],[13,0],[11,4],[10,2],[1,0]]",
        contentHtml: "<strong>Output:</strong> [[7,null],[13,0],[11,4],[10,2],[1,0]]\n",
      },
      `if (!head) return nullptr;
    unordered_map<Node*, Node*> old2new;
    for (Node* n = head; n; n = n->next) old2new[n] = new Node(n->val);
    for (Node* n = head; n; n = n->next) {
      old2new[n]->next = n->next ? old2new[n->next] : nullptr;
      old2new[n]->random = n->random ? old2new[n->random] : nullptr;
    }
    return old2new[head];`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("populating-next-right-pointers-in-each-node-ii: correct level-order-with-dummy solution passes", async () => {
    const { result } = await scaffoldAndRun(
      {
        id: 117,
        title: "Populating Next Right Pointers in Each Node II",
        slug: "populating-next-right-pointers-in-each-node-ii",
        difficulty: "Medium",
        url: "https://leetcode.com/problems/populating-next-right-pointers-in-each-node-ii/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: [
              "/*",
              "// Definition for a Node.",
              "class Node {",
              "public:",
              "    int val;",
              "    Node* left;",
              "    Node* right;",
              "    Node* next;",
              "    Node() : val(0), left(NULL), right(NULL), next(NULL) {}",
              "};",
              "*/",
              "class Solution {",
              "public:",
              "    Node* connect(Node* root) {",
              "        ",
              "    }",
              "};",
            ].join("\n"),
          },
        ],
        metaData: JSON.stringify({
          name: "connect",
          params: [{ name: "root", type: "TreeNode" }],
          return: { type: "TreeNode" },
        }),
        exampleTestcases: "[1,2,3,4,5,null,7]",
        contentHtml: "<strong>Output:</strong> [1,#,2,3,#,4,5,7,#]\n",
      },
      `Node* levelStart = root;
    while (levelStart) {
      Node* dummy = new Node(0);
      Node* tail = dummy;
      for (Node* n = levelStart; n; n = n->next) {
        if (n->left) { tail->next = n->left; tail = tail->next; }
        if (n->right) { tail->next = n->right; tail = tail->next; }
      }
      levelStart = dummy->next;
    }
    return root;`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("1/1 passed");
  });

  test("serialize-and-deserialize-binary-tree: correct preorder-with-null-markers solution passes", async () => {
    const { result } = await scaffoldAndRunFullClass(
      {
        id: 297,
        title: "Serialize and Deserialize Binary Tree",
        slug: "serialize-and-deserialize-binary-tree",
        difficulty: "Hard",
        url: "https://leetcode.com/problems/serialize-and-deserialize-binary-tree/",
        snippets: [
          {
            lang: "C++",
            langSlug: "cpp",
            code: [
              "/**",
              " * Definition for a binary tree node.",
              " * struct TreeNode {",
              " *     int val;",
              " *     TreeNode *left;",
              " *     TreeNode *right;",
              " *     TreeNode(int x) : val(x), left(NULL), right(NULL) {}",
              " * };",
              " */",
              "class Codec {",
              "public:",
              "    string serialize(TreeNode* root) {",
              "        ",
              "    }",
              "    TreeNode* deserialize(string data) {",
              "        ",
              "    }",
              "};",
            ].join("\n"),
          },
        ],
        metaData: JSON.stringify({
          name: "Codec",
          params: [{ name: "root", type: "TreeNode" }],
          return: { type: "string" },
        }),
        exampleTestcases: "[1,2,3,null,null,4,5]\n[]",
        contentHtml: "<strong>Output:</strong> [1,2,3,null,null,4,5]\n<strong>Output:</strong> []\n",
      },
      `    string serialize(TreeNode* root) {
        if (!root) return "#";
        return to_string(root->val) + "," + serialize(root->left) + "," + serialize(root->right);
    }
    TreeNode* deserialize(string data) {
        stringstream ss(data);
        return build(ss);
    }
    TreeNode* build(stringstream& ss) {
        string tok;
        getline(ss, tok, ',');
        if (tok == "#") return nullptr;
        TreeNode* node = new TreeNode(stoi(tok));
        node->left = build(ss);
        node->right = build(ss);
        return node;
    }`,
    );
    expect(result.compiled).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.log).toContain("2/2 passed");
  });
});
