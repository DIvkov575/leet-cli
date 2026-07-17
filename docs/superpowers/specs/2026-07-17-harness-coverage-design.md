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
- `generateHarness`/`scaffoldContent` emit a runnable, asserting harness for
  every fixable problem (61 of the 71 originally missing a harness — see
  Non-goals below for the final, verified count and the 10 documented gaps).
- Unsupported problems report a specific reason, not a generic type mismatch.

## Non-goals (documented remaining gaps)

**Updated during implementation**: verifying against every one of the 71
problems' real, live LeetCode `metaData`/`exampleTestcases` (not just the
stale text already embedded in `artifacts/bundle.json`) surfaced 4 more real
gaps beyond the 6 anticipated at design time — LeetCode's own `metaData` is
occasionally inconsistent with the actual C++ signature or judge behavior in
ways `generateHarness` cannot detect from the type signature alone. Final
count: **61 fixable, 10 documented gaps** (verified by compiling all 61 with
real fetched data, plus end-to-end run checks on a sample with real
solutions). All 10 keep `supported: false` with a specific `reason`:

- `copy-list-with-random-pointer` — metaData reports `ListNode` for `head`,
  but the actual stub defines a differently-shaped `Node` struct (has a
  `random` pointer aliasing another node in the same list); not representable
  by the generic ListNode builder. Detected structurally: metaData claims a
  node type the stub's raw text never uses as a bare identifier.
- `populating-next-right-pointers-in-each-node-ii` — same pattern: metaData
  reports `TreeNode` for `root`/return, but the stub defines a `Node` struct
  with an extra `next` field. Caught by the same structural check above.
- `linked-list-cycle`, `linked-list-cycle-ii` — the real signature takes only
  `head`, but the example testcases encode an extra `pos` value that isn't a
  function parameter; building the described cycle needs special-casing the
  input format, not just the type. Verified with a correct Floyd's-algorithm
  solution: the harness generated without this guard actively FAILS it.
  Denylisted by slug (no structural signal distinguishes this from a
  legitimate single-param signature).
- `delete-node-in-a-linked-list` — same "extra undeclared testcases value"
  problem as the cycle cases, and separately the parameter is an internal
  node (not the list head), so the mutated result has no reachable head to
  serialize/compare even if the input were aligned. Denylisted by slug.
- `all-nodes-distance-k-in-binary-tree`, `lowest-common-ancestor-of-a-binary-search-tree`
  — metaData declares a param (`target`, or `p`/`q`) as `integer`, but the
  real C++ signature takes `TreeNode*`: LeetCode's judge looks up the node by
  value inside the already-built tree and passes the pointer, which the
  per-parameter literal builder has no way to reproduce. Denylisted by slug.
- `serialize-and-deserialize-binary-tree` — uses a multi-method `class Codec`
  (serialize/deserialize), not `class Solution`; metaData.name is literally
  `"Codec"` (the class name, not a method), so the harness's `Solution().
  <name>(...)` call model doesn't apply at all. Detected structurally: no
  `class Solution` in the stub.
- `all-possible-full-binary-trees`, `delete-nodes-and-return-forest` — return
  `list<TreeNode>` where LeetCode's judge accepts any order; a strict
  ordered-vector comparison would produce false failures, which is worse than
  no harness. Detected structurally: return type is `vector<TreeNode*>`.

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

### Error reporting and metaData-reality guards (`resolveHarness` in `src/scaffold.ts`)

`generateHarness`'s own type-signature check only catches gaps that are
visible from `ProblemMeta` alone (unmapped types, void-with-no-params). The
10 documented gaps split into two detection strategies, both applied in a new
`resolveHarness(slug, meta, cases, stub)` gate that runs before
`generateHarness` and returns a specific reason for each:

- **Structural** (3 checks, catch anything matching the pattern, not just
  known slugs):
  - `metaDataClaimsUnusedNodeType` — metaData claims `ListNode`/`TreeNode`
    for a param/return, but that exact identifier never appears as a bare
    word in the stub (the stub uses a differently-shaped `Node` instead).
    Reuses the same whole-word regex `nodeStructDefs` (Part 1) already runs.
  - `stubHasSolutionClass` — the harness always calls `Solution().<method>
    (...)`; skip whenever the stub has no `class Solution` at all (multi-method
    Codec/design classes).
  - Return type is `vector<TreeNode*>` (i.e. metaData's `list<TreeNode>`) —
    order-independent on LeetCode's judge, so no positional harness is safe.
- **Slug-keyed** (`HARNESS_DENYLIST`, 4 entries, each with its own reason) —
  for cases with no structural signal: the misaligned-testcases problems
  (`linked-list-cycle`, `linked-list-cycle-ii`, `delete-node-in-a-linked-list`)
  look identical to a legitimate single-param signature from `ProblemMeta`
  alone, and the two node-by-value problems
  (`all-nodes-distance-k-in-binary-tree`,
  `lowest-common-ancestor-of-a-binary-search-tree`) declare an `integer` param
  that's actually `TreeNode*` in the real signature — neither is detectable
  without parsing the real C++ signature out of the stub, which was judged
  not worth building for 4 known cases (see the second AskUserQuestion
  decision during implementation).

Each denylist/structural-guard reason was verified against a real, incorrect
"attempt" (e.g. a correct Floyd's-cycle-detection solution, run through the
harness *without* the guard, does fail — confirming the gap is real, not
theoretical) before being added.

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
  `merge-k-sorted-lists`'s `ListNode[]` shape, and the structural gaps
  (order-independent `list<TreeNode>` return) asserting `supported: false`
  with the specific reason string.
- `src/scaffold.test.ts`: assert the struct definition appears as real code
  (not inside a comment) exactly once when the stub references
  `ListNode`/`TreeNode`, and is absent otherwise; assert `resolveHarness`'s
  structural guards and denylist entries each produce no harness with the
  right reason, and that unrelated problems are unaffected (no false
  positives).
- New: an end-to-end compile check (extending the pattern in
  `src/runner.test.ts`, which already skips gracefully when no C++ compiler is
  present) that runs `scaffoldContent` for a representative sample of the
  fixable problems and gap problems, compiles each with the real toolchain,
  and asserts the fixable ones compile *and* pass (their own embedded
  cases), while the gap problems still compile (struct-only fix) even without
  a harness.
- Manual verification during implementation: all 71 originally-affected
  slugs' real, live `metaData`/`exampleTestcases`/`content` were fetched
  fresh from LeetCode's GraphQL API (not the stale text in
  `artifacts/bundle.json`) and run through the final `scaffoldContent`. All
  61 "fixable" problems compiled cleanly (`-fsyntax-only`, empty solution
  bodies); a spot-check sample plus the unit-test fixtures were additionally
  compiled *and run* with real correct/incorrect solutions to confirm
  PASS/FAIL behaves correctly, not just "compiles."

## Open risk

The hardcoded struct definitions (Part 1) must exactly match what LeetCode's
own comment says, since a mismatch (e.g. missing constructor overload) would
break compilation for problems whose solution code relies on a specific
constructor signature. Mitigated by copying the struct text directly from the
doc comment already embedded in the bundle rather than retyping it.

## Known limitation

`resolveHarness`'s slug-keyed denylist (4 entries) and the "no class Solution"
structural check only cover known/detectable shapes of "LeetCode's own
metaData doesn't match reality." Since metaData is fetched live per-problem
(not derivable from a fixed schema), a *new* LeetCode problem exhibiting one
of these same quirks (misaligned exampleTestcases, node-by-value params, a
differently-shaped Node struct under a ListNode/TreeNode label, or a
non-Solution multi-method class) would need to be caught the same way this
implementation found the existing 4 — by fetching real data and compiling —
rather than being caught automatically by type-signature inspection alone.
