# Close the remaining 10 test-harness gaps

## Context

The previous harness-coverage work (`2026-07-17-harness-coverage-design.md`,
merged in #23) fixed 61 of 71 originally harness-less bundled problems and
left 10 as documented, deliberate gaps — cases where `generateHarness`'s
generic "call `Solution().method(args)`, compare the return" model couldn't
safely express the problem, and where trusting LeetCode's `metaData` at face
value would have generated a harness that either doesn't compile or actively
fails *correct* solutions.

This round closes all 10, after re-fetching each problem's real, live
`metaData`/`exampleTestcases`/`codeSnippets` from LeetCode's GraphQL API
(not the stale text in `artifacts/bundle.json`) to understand exactly what
each "extra" or "mismatched" metaData field actually represents.

## What the 10 gaps actually were

Re-investigating with real data revealed that in every case, the metaData
"noise" the previous round couldn't parse was not noise at all — it was a
legitimate part of LeetCode's own test setup, just not passed as a real
function argument:

| Slug | The "extra" metaData field | What it's actually for |
|---|---|---|
| `linked-list-cycle`, `linked-list-cycle-ii` | `pos: integer` | Index of the node the tail's `next` should point to — wires a **cycle** into the built list before calling the 1-arg function |
| `delete-node-in-a-linked-list` | `node: integer` (metaData says `head`+`node`) | The **value** of the node to pass — the real function takes only that one node pointer, found by walking the list built from `head` |
| `all-nodes-distance-k-in-binary-tree` | `target: integer` | The **value** of the tree node to pass — the real signature takes `TreeNode* target`, found by BFS inside the built tree |
| `lowest-common-ancestor-of-a-binary-search-tree` | `p: integer`, `q: integer` | Same pattern — both are node values, found inside the built tree |
| `copy-list-with-random-pointer` | metaData says `ListNode`, real struct is `Node{val,next,random}` | Not a mismatch to route around — the real struct is buildable from LeetCode's own `[[val,randomIndex],...]` encoding |
| `populating-next-right-pointers-in-each-node-ii` | metaData says `TreeNode`, real struct is `Node{val,left,right,next}` | Same — buildable from the level-order array, `next` checked post-call |
| `serialize-and-deserialize-binary-tree` | metaData.name is `"Codec"` (a class, not a method) | LeetCode's own usage comment (`Codec ser, deser; deser.deserialize(ser.serialize(root))`) is the literal harness body |
| `all-possible-full-binary-trees`, `delete-nodes-and-return-forest` | Return `list<TreeNode>` | Genuinely order-independent on the judge — needs a multiset comparison, not a rejection |

None of these needed a general C++-signature parser (the "deeper fix" floated
as a future possibility in the previous round's Known Limitation). Each has
a small, fixed shape that a dedicated hand-written generator handles cleanly.

## Architecture

### Part A — order-independent `vector<TreeNode*>` comparison (`src/harness.ts`)

`generateHarness`'s outright rejection of `retType === "vector<TreeNode*>"`
is replaced with a `unorderedTreeReturn` flag threaded through to the
comparison codegen, which emits `__eqUnordered(__got, __exp)` instead of the
positional `__eq`/`==`. `__eqUnordered` (added to `TREENODE_HELPERS`) does a
greedy multiset match: each element of `got` is matched against a
not-yet-used element of `exp` via the existing per-tree `__eq`.

This is a small, generic extension of the existing generic model — no new
module needed, and it also fixes a bug found while implementing this: the
existing `vector<ListNode*>`-as-return path called `__eq(vector<T>,
vector<T>)`, which had no overload (only scalar `__eq(ListNode*,*)` existed).
A `template<T> __eq(const vector<T>&, const vector<T>&)` in `HELPERS` fixes
this for both list and tree vector returns — verified by compiling a
`split-linked-list-in-parts`-shaped harness that failed with "no matching
function for call to `__eq`" before the fix, and passes after.

### Part B — `src/custom-harness.ts`: hand-written generators for non-generic shapes

A new module, `CUSTOM_HARNESS_SLUGS` (a `Set`) and `generateCustomHarness
(slug, exampleTestcases, contentHtml): HarnessResult | null`, dispatched from
`resolveHarness` in `scaffold.ts` **before** any of the generic guards run.
One generator function per slug (8 total), sharing the existing
`__buildList`/`__buildTree`/`__eq`/`__show` helper text where applicable, plus
new small helpers:

- `__buildListWithCycle(vector<int>, pos)` — builds a list, then wires a
  cycle if `pos >= 0` (`linked-list-cycle`, `linked-list-cycle-ii`).
- `__findListNodeByVal` / `__findTreeNodeByVal` — locate a real node by value
  inside an already-built structure (`delete-node-in-a-linked-list`,
  `all-nodes-distance-k-in-binary-tree`,
  `lowest-common-ancestor-of-a-binary-search-tree`).
- `CUSTOM_NODE_STRUCTS` (exported) — real struct text for the two
  differently-shaped `Node` types, injected by `scaffold.ts`'s
  `nodeStructDefs` (which now also takes the slug, since these stubs use the
  bare identifier `Node`, never `ListNode`/`TreeNode`, so the existing
  whole-word scan finds nothing to inject on its own).
- `__buildRandomList` / `__eqRandomList` / `__showRandomList` — for
  `copy-list-with-random-pointer`'s `[[val,randomIndex],...]` encoding
  (two-pass: link `next`, then wire `random` by index since it can point
  forward). The comparison also asserts `__got != __a0` — a solution that
  returns the same list (not a deep copy) must fail.
- `__buildNextPointerTree` / `__levelOrderWithNext` /
  `__showNextPointerTree` — for `populating-next-right-pointers-in-each-node-ii`,
  builds the tree shape from the level-order array (next starts null — it's
  the solution's job to fill it in) and checks the result via a BFS
  invariant (each node's `next` must be the following node in its level, or
  null at the level's end) rather than string-matching LeetCode's own
  `'#'`-per-level output text.
- `serializeDeserializeBinaryTree` — builds `Codec ser, deser;
  deser.deserialize(ser.serialize(root))` per LeetCode's own usage comment,
  compares structurally to the original tree via `__eq`.

### Part C — safety nets stay, now unreachable for their original cases

The two structural guards from the previous round
(`metaDataClaimsUnusedNodeType`, `stubHasSolutionClass`) remain in
`resolveHarness`, *after* the custom-harness dispatch. Their two/one known
real-world triggers are now dispatched before either guard runs, but the
guards themselves still generalize to catch any *other* problem with the
same metaData quirk (a node type mislabeled as ListNode/TreeNode, or a
multi-method class). Their tests were updated to use made-up slugs, since
the real slugs no longer reach them.

The old `HARNESS_DENYLIST` (5 slug-keyed rejections, each with its own
reason string) is removed entirely — every one of those 5 slugs now has a
working custom generator instead of a rejection.

## Testing

- `src/custom-harness.test.ts` (new): unit tests for each of the 8
  generators, asserting on generated code text.
- `src/harness.test.ts`: replaced the two "vector<TreeNode*> return is
  rejected" tests with "vector<TreeNode*> return is supported via
  `__eqUnordered`" tests; added a `vector<ListNode*>`-return test
  (`split-linked-list-in-parts` shape) to lock in the `__eq` overload fix.
- `src/scaffold.test.ts`: replaced the denylist/gap tests (which asserted
  `not.toContain("int main()")` for the 8 now-fixed real slugs) with
  dispatch tests asserting the custom harness fires correctly; the two
  structural-guard tests were re-pointed at made-up slugs.
- `src/harness-coverage.e2e.test.ts`: the "documented gaps still compile"
  section (now empty — there are no more gaps) was replaced with 8
  compile-and-run tests using real correct solutions for every
  custom-harness-dispatched slug. Generalized `withSolutionBody` to work for
  any class name and made it throw loudly on a regex mismatch instead of
  silently no-op'ing (this caught a real bug in the initial `Codec` test
  fixture immediately, since `Codec` has two methods and needed a different
  splice helper — `withFullClassBody` — added alongside it).
- Manual verification: every one of the 71 originally-affected slugs'
  real, live `metaData`/`exampleTestcases`/`content` was re-fetched from
  LeetCode's GraphQL API and run through the final `scaffoldContent`. All 71
  now produce a harness (`int main()`), and all 71 compile cleanly with
  `-fsyntax-only`. A representative sample was additionally compiled *and
  run* with real correct/incorrect solutions (via the e2e test suite and ad
  hoc scripts) to confirm PASS/FAIL behaves correctly, not just "compiles."

## Final result

**71 of 71** originally harness-less bundled problems now have a working,
verified test harness. 0 remaining documented gaps.

Same rollout caveat as the previous round applies: `artifacts/bundle.json`
caches pre-rendered scaffolds and isn't touched by this change — it needs a
`leet sync --force` + `bun run build:artifacts` pass to pick up the fix for
already-cached problems.
