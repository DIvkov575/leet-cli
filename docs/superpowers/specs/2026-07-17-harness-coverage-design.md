# Test harness coverage for void-return and ListNode/TreeNode problems

## Problem

Of 678 bundled problems, 71 scaffold without a runnable test harness (`leet
test` fails with "no test harness (unsupported signature)"). `generateHarness`
(`src/harness.ts`) only emits a harness when every parameter type and the
return type map to a literal-constructible C++ type via `cppType()` — it
rejects `void` returns and any `ListNode`/`TreeNode` type outright.

Breakdown of the 71:

- **10** void-return, plain-vector params (e.g. `sort-colors`, `sudoku-solver`,
  `rotate-image`) — in-place mutation, nothing returned to assert on.
- **2** void-return, ListNode/TreeNode params (`flatten-binary-tree-to-linked-list`,
  `reorder-list`) — same shape, but the mutated value is a linked structure.
- **52** non-void, ListNode and/or TreeNode in params/return (e.g.
  `add-two-numbers`, `invert-binary-tree`) — the more common interview shape.
- **1** `merge-k-sorted-lists` — `ListNode[]` param, `ListNode` return; fits the
  generic ListNode builder once it exists.
- **6** genuine special cases, listed under Non-goals below.

A second, more severe bug was found during investigation: **none of the 62
ListNode/TreeNode-touching scaffolds compile today.** LeetCode's starter stub
embeds the `struct ListNode { ... }` / `struct TreeNode { ... }` definition
only inside a `/** ... */` doc comment (mirroring leetcode.com, where the
judge supplies the real struct) — so `class Solution { ListNode*
addTwoNumbers(ListNode* l1, ...) }` references an undeclared type. `leet test`
on any of these fails at compile, independent of harness support. Fixing this
is a prerequisite for harness generation (you can't construct a `ListNode*`
argument if the struct isn't real code) and is included below.

## Goals

- Every scaffolded `.cpp` file that references `ListNode`/`TreeNode` compiles.
- `generateHarness` emits a runnable, asserting harness for the 65 fixable
  problems (10 + 2 + 52 + 1, per above).
- Unsupported problems report a specific reason, not a generic type mismatch.

## Non-goals (documented remaining gaps)

These 6 keep `supported: false` with a specific `reason`, not a generic
"unsupported type" message:

- `copy-list-with-random-pointer` — a different `Node` struct (has `random`
  pointer aliasing another node in the same list); not representable by the
  generic ListNode builder.
- `linked-list-cycle`, `linked-list-cycle-ii` — the real signature takes only
  `head`, but the example testcases encode an extra `pos` value that isn't a
  function parameter; building the described cycle needs special-casing the
  input format, not just the type.
- `delete-node-in-a-linked-list` — the parameter is an internal node (not the
  list head), so the mutated result has no reachable head to serialize/compare.
- `all-possible-full-binary-trees`, `delete-nodes-and-return-forest` — return
  `list<TreeNode>` where LeetCode's judge accepts any order; a strict
  ordered-vector comparison would produce false failures, which is worse than
  no harness.

## Architecture

### Part 1 — struct definitions become real code (`src/scaffold.ts`)

`scaffoldContent` already assembles: header comment → includes → starter stub
→ (harness | comment fallback). Add a step between includes and stub:

- Scan the raw stub text for the whole-word identifier `ListNode` or
  `TreeNode`.
- If found, inject a **fixed, hardcoded** canonical struct definition (exact
  match to LeetCode's own convention — the same one that currently ships
  inside the doc comment) as real code, once per file, before `class
  Solution`.
- This is independent of whether `metaData` supports a harness — it fixes
  compilation for all 62 touched problems, including the 5 ListNode/TreeNode
  documented gaps (only `copy-list-with-random-pointer`'s `Node` struct is
  untouched, consistent with treating it as a gap).

No new types needed: this is a pure string-processing addition to
`scaffoldContent`.

### Part 2 — void-return support (`src/harness.ts`)

In `generateHarness`, the current rule rejects `retType === null || retType
=== "void"` unconditionally. Change to: `void` is acceptable *if there is at
least one parameter*, using the first parameter as the observable result.

- Materialize `__a0` as today (named local, mutable).
- Call `Solution().foo(__a0, ...)` for its side effect, discarding any return.
- Print/compare `__a0`'s value post-call against the parsed expected output,
  using the same `__show`/`__str`/`__ok` pattern already used for return
  values — just sourced from the mutated argument instead of a return
  expression.
- Applies uniformly whether `__a0`'s type is a scalar/vector (Part 2a, 10
  problems) or ListNode/TreeNode (Part 2b, 2 problems, built on Part 3's
  helpers below).

### Part 3 — ListNode/TreeNode construction and comparison (`src/harness.ts`)

`cppType()` currently returns `null` for `ListNode`/`TreeNode`, which is the
signal `generateHarness` uses to bail out. Change:

1. `cppType("ListNode")` → `"ListNode*"`, `cppType("TreeNode")` → `"TreeNode*"`
   (and `list<ListNode>`/`list<TreeNode>`-style array-of nesting → e.g.
   `vector<ListNode*>` for `merge-k-sorted-lists`'s `ListNode[]` param).
2. `jsonToCppLiteral` for `ListNode*`/`TreeNode*`: instead of emitting a
   literal directly, emit a call to a generated builder helper —
   `__buildList({1,2,3})` / `__buildTree({4,2,7,1,3,{},9})` — using `nullopt`
   (via `optional<int>`) for tree `null` gaps in the level-order array, matching
   LeetCode's serialization.
3. New emitted helpers (alongside the existing `__show`/`__str` block, only
   included in files that need them):
   - `ListNode* __buildList(vector<int>)`, `TreeNode* __buildTree(vector<optional<int>>)`
     (level-order queue-based construction for the tree).
   - `bool __eq(ListNode*, ListNode*)`, `bool __eq(TreeNode*, TreeNode*)` —
     recursive structural + value equality (replaces `==` for these types,
     since the generated code compares pointers otherwise).
   - `__show` overloads for `ListNode*`/`TreeNode*` that re-serialize back to
     bracket notation for readable PASS/FAIL output.
4. The main-loop codegen (`__ok = (__got == __exp)`) becomes `__ok =
   __eq(__got, __exp)` whenever either side's type is ListNode*/TreeNode*
   (scalar/vector cases keep plain `==`, unchanged).

### Error reporting

`HarnessResult.reason` gains a few specific strings for the Non-goals list
(e.g. `"cyclic structure (pos parameter) unsupported"`,
`"random-pointer aliasing unsupported"`, `"parameter is not the list head — result not observable"`,
`"list<TreeNode> return: order-independent, no harness"`) instead of falling
through to the generic `unsupported type(s): ...` message. These are
detected by slug-independent structural checks where possible (e.g. "return
type is list<TreeNode>" is a type check), and by the existing generic
type-mismatch path for the couple of cases that are genuinely about the type
system (`Node` is simply a different, unmapped type name).

## Data flow (unchanged shape)

`scaffoldContent(ScaffoldInput)` → header + includes + struct-if-needed + stub
+ (harness | comment). `generateHarness(ProblemMeta, ExampleCase[])` →
`HarnessResult`. No changes to `ScaffoldInput`, `ProblemMeta`, or
`ExampleCase` — this is purely an internal capability upgrade to the existing
pipeline.

## Rollout: bundle regeneration

`artifacts/bundle.json` stores only the final rendered `{ cpp, desc }` per
problem — it does not store raw `metaData`/`exampleTestcases`, so it cannot be
patched in place. The bundle is built by `scripts/build-artifacts.ts`, which
fetches each problem's already-packaged `<id>-<slug>.cpp` from the public
`DIvkov575/leetcode-problems` repo (via `bun run build:artifacts`) — it does
not run `scaffoldContent` itself.

This means the fix has two rollout steps, in order:
1. Land the `scaffoldContent`/`harness.ts` changes in `leet-cli`.
2. Re-run `leet sync <owner/repo> --force` (or the equivalent maintainer
   workflow) against the public solutions repo so its packaged `.cpp` files
   regenerate through the fixed `scaffoldContent`, **then** re-run `bun run
   build:artifacts` to refresh `artifacts/bundle.json` from the updated repo.

Until step 2 runs, the embedded bundle keeps serving the old (non-compiling /
harness-less) scaffolds for previously-cached problems; only fresh `--fresh`
fetches or newly-synced problems pick up the fix immediately. This is called
out explicitly so it isn't mistaken for a bug after the code change lands.

## Testing

- `src/harness.test.ts`: extend with cases for void-return (vector and
  ListNode/TreeNode), ListNode/TreeNode non-void (param, return, and both),
  `merge-k-sorted-lists`'s `ListNode[]` shape, and each of the 6 documented
  gaps asserting `supported: false` with the specific reason string.
- `src/scaffold.test.ts`: assert the struct definition appears as real code
  (not inside a comment) exactly once when the stub references
  `ListNode`/`TreeNode`, and is absent otherwise.
- New: an end-to-end compile check (extending the pattern in
  `src/runner.test.ts`, which already skips gracefully when no C++ compiler is
  present) that runs `scaffoldContent` for a representative sample of the 65
  fixable problems and 6 gap problems, compiles each with the real toolchain,
  and asserts the fixable ones compile *and* pass (their own embedded
  cases), while the gap problems still compile (struct-only fix) even without
  a harness.

## Open risk

The hardcoded struct definitions (Part 1) must exactly match what LeetCode's
own comment says, since a mismatch (e.g. missing constructor overload) would
break compilation for problems whose solution code relies on a specific
constructor signature. Mitigated by copying the struct text directly from the
doc comment already embedded in the bundle rather than retyping it.
