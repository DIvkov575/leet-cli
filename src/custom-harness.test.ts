import { describe, expect, test } from "bun:test";
import { CUSTOM_HARNESS_SLUGS, CUSTOM_NODE_STRUCTS, generateCustomHarness } from "./custom-harness.ts";

describe("CUSTOM_HARNESS_SLUGS", () => {
  test("includes serialize-and-deserialize-binary-tree", () => {
    expect(CUSTOM_HARNESS_SLUGS.has("serialize-and-deserialize-binary-tree")).toBe(true);
  });
  test("does not include an ordinary problem", () => {
    expect(CUSTOM_HARNESS_SLUGS.has("two-sum")).toBe(false);
  });
});

describe("generateCustomHarness — serialize-and-deserialize-binary-tree", () => {
  test("builds Codec ser/deser and round-trips the tree", () => {
    const r = generateCustomHarness(
      "serialize-and-deserialize-binary-tree",
      "[1,2,3,null,null,4,5]\n[]",
      "<strong>Output:</strong> [1,2,3,null,null,4,5]\n<strong>Output:</strong> []\n",
    );
    expect(r).not.toBeNull();
    expect(r!.supported).toBe(true);
    expect(r!.code).toContain("int main()");
    expect(r!.code).toContain("TreeNode* __root = __buildTree({1,2,3,nullopt,nullopt,4,5});");
    expect(r!.code).toContain("Codec __ser, __deser;");
    expect(r!.code).toContain("TreeNode* __got = __deser.deserialize(__ser.serialize(__root));");
    expect(r!.code).toContain("__eq(__got, __root)");
  });

  test("returns null for an unknown slug", () => {
    expect(generateCustomHarness("two-sum", "1\n2", "<strong>Output:</strong> 3\n")).toBeNull();
  });
});

describe("generateCustomHarness — linked-list-cycle", () => {
  test("wires pos as a cycle, calls hasCycle(head) with 1 real arg", () => {
    const r = generateCustomHarness(
      "linked-list-cycle",
      "[3,2,0,-4]\n1\n[1]\n-1",
      "<strong>Output:</strong> true\n<strong>Output:</strong> false\n",
    );
    expect(r).not.toBeNull();
    expect(r!.code).toContain("ListNode* __a0 = __buildListWithCycle({3,2,0,-4}, 1);");
    expect(r!.code).toContain("Solution().hasCycle(__a0);");
    expect(r!.code).toContain("bool __exp = true;");
    expect(r!.code).toContain("ListNode* __a0 = __buildListWithCycle({1}, -1);");
    expect(r!.code).toContain("bool __exp = false;");
  });
});

describe("generateCustomHarness — linked-list-cycle-ii", () => {
  test("compares the returned node by identity against the node at index pos", () => {
    const r = generateCustomHarness(
      "linked-list-cycle-ii",
      "[3,2,0,-4]\n1",
      "<strong>Output:</strong> tail connects to node index 1\n",
    );
    expect(r).not.toBeNull();
    expect(r!.code).toContain("ListNode* __a0 = __buildListWithCycle(__v0, 1);");
    expect(r!.code).toContain("Solution().detectCycle(__a0);");
    expect(r!.code).toContain("__got == __expNode");
  });

  test("pos=-1 (no cycle) expects a null return", () => {
    const r = generateCustomHarness(
      "linked-list-cycle-ii",
      "[1]\n-1",
      "<strong>Output:</strong> no cycle\n",
    );
    expect(r).not.toBeNull();
    expect(r!.code).toContain("__buildListWithCycle(__v0, -1)");
    expect(r!.code).toContain("ListNode* __expNode = nullptr;");
  });
});

describe("generateCustomHarness — delete-node-in-a-linked-list", () => {
  test("finds the target node by value, calls deleteNode(node), checks the original head", () => {
    const r = generateCustomHarness(
      "delete-node-in-a-linked-list",
      "[4,5,1,9]\n5\n[4,5,1,9]\n1",
      "<strong>Output:</strong> [4,1,9]\n<strong>Output:</strong> [4,5,9]\n",
    );
    expect(r).not.toBeNull();
    expect(r!.code).toContain("ListNode* __a0 = __buildList({4,5,1,9});");
    expect(r!.code).toContain("ListNode* __target = __findListNodeByVal(__a0, 5);");
    expect(r!.code).toContain("Solution().deleteNode(__target);");
    expect(r!.code).toContain("ListNode* __exp = __buildList({4,1,9});");
    expect(r!.code).toContain("__eq(__a0, __exp)");
  });
});

describe("generateCustomHarness — all-nodes-distance-k-in-binary-tree", () => {
  test("finds target by value, builds the harness, compares sorted (any-order) results", () => {
    const r = generateCustomHarness(
      "all-nodes-distance-k-in-binary-tree",
      "[3,5,1,6,2,0,8,null,null,7,4]\n5\n2",
      "<strong>Output:</strong> [7,4,1]\n",
    );
    expect(r).not.toBeNull();
    expect(r!.code).toContain("TreeNode* __target = __findTreeNodeByVal(__a0, 5);");
    expect(r!.code).toContain("Solution().distanceK(__a0, __target, 2);");
    expect(r!.code).toContain("sort(__gotSorted.begin(), __gotSorted.end());");
  });
});

describe("generateCustomHarness — lowest-common-ancestor-of-a-binary-search-tree", () => {
  test("finds p/q by value, compares the returned node's value", () => {
    const r = generateCustomHarness(
      "lowest-common-ancestor-of-a-binary-search-tree",
      "[6,2,8,0,4,7,9,null,null,3,5]\n2\n8",
      "<strong>Output:</strong> 6\n",
    );
    expect(r).not.toBeNull();
    expect(r!.code).toContain("TreeNode* __p = __findTreeNodeByVal(__a0, 2);");
    expect(r!.code).toContain("TreeNode* __q = __findTreeNodeByVal(__a0, 8);");
    expect(r!.code).toContain("Solution().lowestCommonAncestor(__a0, __p, __q);");
    expect(r!.code).toContain("int __exp = 6;");
  });
});

describe("CUSTOM_NODE_STRUCTS", () => {
  test("has real (compilable) struct text for both differently-shaped Node problems", () => {
    expect(CUSTOM_NODE_STRUCTS["copy-list-with-random-pointer"]).toContain("Node* random;");
    expect(CUSTOM_NODE_STRUCTS["populating-next-right-pointers-in-each-node-ii"]).toContain(
      "Node* next;",
    );
  });
});

describe("generateCustomHarness — copy-list-with-random-pointer", () => {
  test("builds from [[val,randomIndex],...] encoding, compares value+random-index chains", () => {
    const r = generateCustomHarness(
      "copy-list-with-random-pointer",
      "[[7,null],[13,0],[11,4],[10,2],[1,0]]",
      "<strong>Output:</strong> [[7,null],[13,0],[11,4],[10,2],[1,0]]\n",
    );
    expect(r).not.toBeNull();
    expect(r!.code).toContain("vector<int> __vals0 = {7,13,11,10,1}, __rand0 = {-1,0,4,2,0};");
    expect(r!.code).toContain("Node* __a0 = __buildRandomList(__vals0, __rand0);");
    expect(r!.code).toContain("Solution().copyRandomList(__a0);");
    expect(r!.code).toContain("__eqRandomList(__got, __exp)");
    // Must not accept a solution that returns the same nodes (not a real copy).
    expect(r!.code).toContain("__got != __a0");
  });
});

describe("generateCustomHarness — populating-next-right-pointers-in-each-node-ii", () => {
  test("builds the tree shape, checks next pointers via BFS invariant", () => {
    const r = generateCustomHarness(
      "populating-next-right-pointers-in-each-node-ii",
      "[1,2,3,4,5,null,7]",
      "<strong>Output:</strong> [1,#,2,3,#,4,5,7,#]\n",
    );
    expect(r).not.toBeNull();
    expect(r!.code).toContain("Node* __a0 = __buildNextPointerTree({1,2,3,4,5,nullopt,7});");
    expect(r!.code).toContain("Solution().connect(__a0);");
    expect(r!.code).toContain("__level[i]->next != __expNext");
  });
});
