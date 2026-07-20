/**
 * End-to-end verification that scaffoldContent's output for the newly-covered
 * problem shapes (void-return, ListNode, TreeNode, vector<ListNode*>) actually
 * compiles and runs with a real C++ toolchain — the unit tests in
 * harness.test.ts/scaffold.test.ts check the generated *text*, this checks it
 * *executes correctly*. Also verifies the 6 documented gaps still compile
 * (Part 1's struct fix) even though no harness is generated for them.
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

/** Splice a solution body into scaffoldContent's output between the stub's braces. */
function withSolutionBody(content: string, solutionBody: string): string {
  return content.replace(
    /(class Solution \{\npublic:\n[^\n]*\{\n)( *)\n(\s*\}\n\};)/,
    (_m, open: string, _indent: string, close: string) => `${open}${solutionBody}\n${close}`,
  );
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

/**
 * Syntax/type-check only (no linking) — for the documented-gap problems,
 * which legitimately have no harness/main() to link. Proves Part 1's struct
 * injection alone is enough to make the file well-formed C++.
 */
async function scaffoldAndCheckSyntax(input: ScaffoldInput, solutionBody: string) {
  const content = withSolutionBody(scaffoldContent(input), solutionBody);
  const dir = mkdtempSync(join(tmpdir(), "leet-harness-e2e-"));
  const path = join(dir, `${input.id}-${input.slug}.cpp`);
  await Bun.write(path, content);
  const proc = Bun.spawn([cxx!, "-std=c++17", "-fsyntax-only", path], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  rmSync(dir, { recursive: true, force: true });
  return { content, compiled: code === 0, log: (out + err).trim() };
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

maybe("harness coverage — documented gaps still compile (struct fix applies)", () => {
  test("linked-list-cycle: no harness, but the ListNode struct makes it compile", async () => {
    const { content, compiled } = await scaffoldAndCheckSyntax(
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
          params: [{ name: "head", type: "ListNode" }],
          return: { type: "boolean" },
        }),
        exampleTestcases: "[3,2,0,-4]\n1",
        contentHtml: "<strong>Output:</strong> true\n",
      },
      `ListNode* slow = head, *fast = head;
    while (fast && fast->next) {
      slow = slow->next; fast = fast->next->next;
      if (slow == fast) return true;
    }
    return false;`,
    );
    expect(content).not.toContain("int main()");
    expect(compiled).toBe(true);
  });

  test("delete-node-in-a-linked-list: no harness, but compiles", async () => {
    const { content, compiled } = await scaffoldAndCheckSyntax(
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
          params: [{ name: "node", type: "ListNode" }],
          return: { type: "void" },
        }),
        exampleTestcases: "[4,5,1,9]\n5",
        contentHtml: "<strong>Output:</strong> [4,1,9]\n",
      },
      `node->val = node->next->val;
    node->next = node->next->next;`,
    );
    expect(content).not.toContain("int main()");
    expect(compiled).toBe(true);
  });

  test("copy-list-with-random-pointer: no harness (different Node type), still compiles", async () => {
    const { content, compiled } = await scaffoldAndCheckSyntax(
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
              "class Node {",
              "public:",
              "    int val;",
              "    Node* next;",
              "    Node* random;",
              "    Node(int _val) { val = _val; next = NULL; random = NULL; }",
              "};",
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
          params: [{ name: "head", type: "Node" }],
          return: { type: "Node" },
        }),
        exampleTestcases: "[[7,null]]",
        contentHtml: "<strong>Output:</strong> [[7,null]]\n",
      },
      "return head; // stub — only compilation is being checked here",
    );
    expect(content).not.toContain("int main()");
    expect(compiled).toBe(true);
  });

});
