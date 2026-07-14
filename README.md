# leet-cli

A terminal workflow for LeetCode company problem lists. Built with
[Bun](https://bun.sh) (native TypeScript, no build step).

- **Browse** bundled company lists (Uber, Google, Meta, Citadel, …) plus
  NeetCode 250, in a four-panel TUI — Lists │ Problems │ Preview │ Logs.
- **Solve & test** — scaffold a C++ file with an embedded test harness, compile
  and run it, all from the keyboard.
- **Track** what you've done, locally and in sync with your LeetCode account.
- **Sync with LeetCode** — pull your solved problems down, or push solutions up
  to mark them Accepted (from the CLI or the interactive **Sync** menu).

## Install

### Homebrew (recommended)

```sh
brew install DIvkov575/leet/leet
```

A single standalone binary — no Bun, Node, or `gh` required. Available for macOS
(Apple Silicon + Intel) and Linux (x64 + arm64).

### From source (Bun)

```sh
bun install          # no runtime deps
bun link             # optional: exposes `leet` on your PATH
# or just run directly:
bun run src/cli.ts <command>
```

Compile your own standalone binary:

```sh
bun run compile      # produces ./leet (bundled lists are embedded)
```

### Problem-list caching

The bundled lists are **embedded in the binary**, so browsing works with no
network at all. Problem *statements* and C++ stubs are fetched lazily and cached
the first time you `solve` or preview a problem — nothing is downloaded up front.

For offline study, you can pre-cache a whole set. On **first launch** the picker
offers this as a one-time suggestion (press **P** to pre-cache `neetcode-250`,
any other key to dismiss) — it's opt-in, never a silent background download. Or
do it explicitly:

```sh
leet setup                           # pre-cache neetcode-250 (repo over HTTPS, LeetCode fallback)
leet setup --list uber               # pre-cache a different list
LEET_NO_SETUP=1 leet                 # suppress the first-run suggestion
```

`refresh` and any downloaded lists are written to `$XDG_DATA_HOME/leet-cli/lists`
and shadow the embedded copies.

## Bundled lists

Company-tagged sets plus `neetcode-250`. Run `leet lists` for the current set
and problem counts; the interactive picker (`leet`) shows unsolved/total per
list. Bundled lists include `uber`, `google`, `nvidia`, `meta`, `bloomberg`,
`citadel`, `neetcode-250`, and a dozen smaller firm lists (Two Sigma, Point72,
Jane Street, Optiver, SIG, Hudson River Trading, and more).

Each problem carries its number, title, slug, URL, acceptance rate, and difficulty.

## Usage

```sh
leet                             # open the interactive browser (see below)
leet tui [list]                  # same, optionally starting on a specific list
leet lists                       # list the bundled problem lists
leet ls <list> [filters]         # print a list as a table
leet show <id|slug> [--live]     # show one problem (--live fetches the statement)
leet open <id|slug> [list]       # open a problem in the browser
leet random [list] [filters]     # print one random problem
leet solve <id|slug> [-o]        # scaffold a C++ file (cache-first); -o opens it
leet test <id|slug>              # compile the scaffolded solution and run its harness
leet done [id|slug ...]          # mark problems done, or list what's done
leet undone <id|slug ...>        # unmark problems as done
leet import <path|owner/repo>    # mark done from NeetCode (or --adapter leetcode)
leet auth                        # grab your LeetCode session from a local browser
leet push [--source …] [--yes]   # submit solutions to LeetCode to mark them Accepted
leet sync [owner/repo] [list...] # package problems into a GitHub repo (default: your sync repo)
leet sync-repo [create|adopt …]  # form/register your solution-sync repo (saved in config)
leet pull-solutions [owner/repo] # add solved problems missing from your sync repo
leet mark-solved [owner/repo]    # mark problems done locally from the folders present in a sync repo
leet setup [--list <name>]       # pre-cache a study set for offline solve
leet refresh <list|--all>        # refresh acceptance/difficulty from LeetCode
leet config [key value|--unset]  # show or set settings (editor, solutionsDir, cxx, recommend, recommendExclude)
```

Every command has a one-line summary in `leet help`; the LeetCode-account
features (`auth`, `import --adapter leetcode`, `push`) are documented in detail
below and are also reachable from the interactive **Sync** menu.

## Configuration

Settings persist to `config.json` in the data dir (`$XDG_DATA_HOME/leet-cli`, or
`~/.local/share/leet-cli`). Each is optional and layers over the matching
environment variable, then a built-in default:

| Key                | Overrides            | Used by             | Default              |
|--------------------|----------------------|---------------------|----------------------|
| `editor`           | `$VISUAL`/`$EDITOR`  | `solve -o`          | nvim/vim/vi if found |
| `solutionsDir`     | —                    | `solve` / `test`    | `solutions`          |
| `cxx`              | `$CXX`               | `test`              | `c++`                |
| `recommend`        | —                    | ★ Recommended list  | `popularity` (or `acceptance`) |
| `recommendExclude` | —                    | ★ Recommended list  | none — every list counts |
| `syncRepo`         | `$LEET_SYNC_REPO`    | `sync` / `pull-solutions` / `mark-solved` | unset |

```sh
leet config                              # show all settings
leet config editor "code -w"             # set the editor
leet config recommend acceptance         # change the recommendation ranking
leet config recommendExclude citadel,sig # drop these lists from ★ Recommended
leet config recommendExclude --unset     # back to every list counting
leet config cxx --unset                  # clear a setting
```

The `recommend` strategy is modular — `popularity` ranks by how many company
lists a problem appears in (most-asked first); `acceptance` ranks the most
approachable unsolved problems first.

### Tuning ★ Recommended

By default **every list counts** toward ★ Recommended, so it's populated out of
the box. `recommendExclude` drops the lists you don't want voting — handy if
you're not interviewing at, say, the quant shops:

```sh
leet config recommendExclude citadel,jane-street,two-sigma,sig
```

In the TUI the config picker shows this as a positive **include checklist**
(every list ticked by default); `space` toggles one, `a` includes all, `n`
includes none. Lists you untick stay **fully browsable** — they simply don't
contribute to the cross-list popularity signal, and aren't cited in the
preview's
"appears in N lists" line.

Inside the interactive browser, open the settings screen with **`c`** (from any
panel, or the **Config** menu item). Enter edits the selected field, `x` clears
it, Esc saves and closes. **Recommend: skip lists** opens a checkbox picker —
`space` toggles a list, `a` clears every tick. Changes re-rank ★ Recommended
immediately, without a restart.

### Filters (for `ls` / `random`)

| Flag                | Meaning                                   |
|---------------------|-------------------------------------------|
| `--difficulty, -d`  | `easy` \| `medium` \| `hard`              |
| `--min-acc <n>`     | minimum acceptance %                      |
| `--max-acc <n>`     | maximum acceptance %                      |
| `--search, -s <q>`  | title substring match                     |
| `--done`            | only completed problems                   |
| `--todo`            | only problems not yet completed           |
| `--sort <key>`      | `id` \| `acc` \| `difficulty` \| `title`  |
| `--desc`            | reverse sort order                        |
| `--limit, -n <n>`   | cap the number of rows                    |
| `--json`            | emit JSON instead of a table              |

### Examples

```sh
leet ls nvidia -d hard --sort acc
leet ls uber --search tree --limit 20
leet done 42 two-sum             # tick off problems you've solved
leet ls uber --todo              # what's left in the uber list
leet random uber -d medium --todo
leet show 42 --live
leet refresh nvidia
```

## Interactive mode

Just run **`leet`** to open the full-screen browser — this is the primary way
to use the tool, and a front-end for everything the subcommands do. It's built
around **four hierarchical panels — Lists │ Problems │ Preview │ Logs**:

- **Lists** — every bundled list with done/left/total counts, plus two views at
  the top: **★ Recommended** (the highest-signal unsolved problems across the
  lists you opted into — ranking set by `recommend` in config) and **all** (the
  de-duplicated union of every list, so you can browse the whole catalog at
  once). A bare `leet` opens on **all**.
- **Problems** — the problems in the selected list (or the recommended set),
  filterable/sortable/searchable.
- **Preview** — the selected problem's statement, links, and a copy-paste solve
  command.
- **Logs** — the compiled/run output of the test harness. Press **`t`** to
  compile & run the current problem; the panel header turns green (PASS) or red
  (FAIL/compile error) and shows the captured output.

**`→` / `Enter` drills deeper** (open a list → preview a problem → its test
logs); **`←` / `Esc` steps back out**. From the Problems or Preview panel,
**`s`** branches off into *solve* (scaffold the C++ file cache-first and open it
in your editor) and **`t`** into *test* (compile & run, output in Logs).

Press **`F`** from Problems, Preview, or Logs to enter **fullscreen reading
mode**: the statement (and, on a wide terminal, the test logs beside it) takes
the whole screen so a long problem is comfortable to read. `Tab` flips focus
between the description and the logs; `↑↓`/`PgUp`/`PgDn`/`g`/`G` scroll; `s`/`t`
still solve/test; `F` or `Esc` leaves.

Every action also lives in a **menu bar** across the top — press **Tab** to
enter it, `←→` to move, `Enter` to fire (Filter · Difficulty · Sort · Search ·
List · Open · Refresh · Import · Sync · Config · Help); `Esc` returns to your
panel. The **Sync** menu runs the LeetCode account features right in the TUI —
authenticate from your browser, pull your solved problems, and push solutions
(with an in-panel confirm before any real submission).
The layout adapts to width — it shows as many adjacent panels as fit (~38 cols
each), always including the focused one, down to a single panel when narrow
(it's all hierarchical, so one-at-a-time still works).

Core keys:

| Key              | Action                                            |
|------------------|---------------------------------------------------|
| `↑`/`↓`, `j`/`k` | move within the focused panel                     |
| `→` / `Enter`    | drill in (list → problems → preview → logs)       |
| `←` / `Esc`      | step back out                                     |
| `g` / `G`        | jump to top / bottom · PgUp/PgDn page             |
| `Space`          | toggle done (saved immediately)                   |
| `s`              | solve — scaffold the C++ file and open it         |
| `t`              | test — compile & run the harness (output in Logs) |
| `F`              | fullscreen reading mode (description + logs)      |
| `Tab`            | enter the menu bar                                |
| `q` / Ctrl-C     | quit (restores the terminal)                      |

Each menu item also has a direct shortcut, usable from any panel: `f` filter,
`d` difficulty, `S` sort, `/` search, `r` random, `L` lists, `o` open, `R`
refresh, `i` import, `c` config, `?` help. `s` is reserved for **solve** on the
Problems/Preview panels. Press `?` in-app for the full reference.

The preview resolves each statement **cache-first**: it checks the local cache,
then the packaged `.md` in your synced solutions repo, and only falls back to a
live LeetCode fetch for a problem that has never been synced or seen. Whatever a
network step returns is written back to the cache, so any given problem hits
LeetCode at most once — after a `leet sync` or `leet setup`, browsing and
previewing are effectively offline. The one-shot subcommands below remain
available for scripting and piping.

## Tracking completed problems

`leet done <id|slug ...>` marks problems as completed and `leet undone ...`
unmarks them; `leet done` with no arguments lists everything you've finished.
Completed problems show a green `✓` in tables and single-problem views, and the
`--done` / `--todo` filters narrow any `ls` or `random` to solved vs. unsolved.

Completion is tracked by the global LeetCode problem number, so ticking off a
problem in one list marks it everywhere it appears. State lives in a single
`completed.json` outside the repo — `$XDG_DATA_HOME/leet-cli/` (default
`~/.local/share/leet-cli/`), overridable with `LEET_DATA_DIR` — so it survives
`refresh` and package updates.

## Importing completed problems

If you already track solved problems elsewhere, `leet import` bulk-marks them
done. Sources are handled by pluggable **adapters** (`src/adapters.ts`); the
built-in `neetcode` adapter understands [NeetCode.io](https://neetcode.io)'s
GitHub sync repos (`neetcode-submissions-*`), which store one
`.../<slug>/submission-N.<ext>` folder per solved problem.

```sh
leet import DIvkov575/neetcode-submissions-xxxx        # from a GitHub repo (uses gh auth)
leet import ~/code/neetcode-submissions                # from a local clone or path
leet import <repo> --dry-run                           # preview without saving
leet import <repo> --ref main                          # pin a branch/tag/sha
leet import <repo> --adapter neetcode                  # choose the source format
```

A GitHub source is fetched through the authenticated `gh` CLI (so private repos
work); a local path is walked directly. Imported problems are matched to the
bundled lists by slug, then by an adapter alias map (NeetCode renames many
problems, e.g. `anagram-groups` → `group-anagrams`), then by normalized title.
Anything solved that is not in any bundled list is reported and skipped, and the
import is idempotable — re-running only marks what is new.

### Resync directly from LeetCode

The `leetcode` adapter pulls your solved problems straight from your LeetCode
account — no repo needed. It authenticates with your `LEETCODE_SESSION` cookie.

The easiest way to get the cookie is **`leet auth`**, which grabs it from a
browser where you're logged into leetcode.com and saves it to config:

```sh
leet auth                          # tries Firefox, then Chrome
leet auth --from-firefox           # force a specific browser
leet import --adapter leetcode     # then resync everything you've solved
```

Firefox is the reliable source (its cookie store is plaintext). Recent Chrome
versions use *app-bound* cookie encryption that external tools can't read, so if
you only use Chrome, set the cookie manually instead — copy `LEETCODE_SESSION`
from devtools → Application → Cookies → `leetcode.com`:

```sh
export LEETCODE_SESSION=<cookie value>       # optionally: export LEETCODE_CSRF=<token>
leet import --adapter leetcode
```

The session can also live in `config.json` as `leetcodeSession` (it's kept out
of the interactive settings screen since it's a credential). This uses LeetCode's
unofficial GraphQL endpoint; the cookie expires periodically, and an expired one
reports a clear error rather than silently importing nothing.

## Submitting solutions to LeetCode

`leet push` submits solutions to LeetCode so problems are marked **Accepted** on
your account — e.g. to backfill problems you solved elsewhere. It sources a C++
solution per problem (default: the [neetcode-gh](https://github.com/neetcode-gh/leetcode)
community repo; or `--source dir` to submit your own `<id>-<slug>.cpp` files from
the solutions dir), submits it, and waits for the judge's verdict.

```sh
leet push --limit 5          # dry run: show what would be submitted
leet push --limit 5 --yes    # actually submit (5 real submissions)
leet push --yes              # submit every problem not yet Accepted on LeetCode
leet push --source dir --yes # submit your own solution files
leet push --yes --delay 20   # go slower (20s between submissions)
```

It skips problems **already Accepted on your LeetCode account** (checked live,
not from local tracking — so problems you only marked done via `import` are still
pushed). Use `--all` to re-submit everything regardless.

It **writes to your LeetCode account**, so it defaults to a dry run and does
nothing until you pass `--yes`. It submits **one at a time**, spaced ~12s apart
(`--delay <sec>` to change), and on a rate-limit (HTTP 429) it backs off
exponentially (honoring `Retry-After`) and retries rather than skipping the
problem. Progress is saved incrementally, so a stop keeps what's already
Accepted. Cap a run with `--limit`. Requires `leet auth` first (submitting needs
the CSRF token, not just the session).

> Note: submitting community solutions backfills your profile with code you
> didn't write, and some solutions may not match LeetCode's exact problem
> variant (Wrong Answer). Use deliberately.

## Your solution-sync repo

leet-cli can keep a personal GitHub repo of your solutions (a NeetCode-style
layout: `Data Structures & Algorithms/<slug>/submission-0.<ext>`) and treat it
as the hub for completion tracking. Register it once and the sync commands
default to it:

```sh
leet sync-repo adopt DIvkov575/my-solutions   # point at an existing repo
leet sync-repo create my-solutions            # gh repo create (public), then save it
leet sync-repo                                # show the configured repo
leet sync-repo unset                          # clear it
```

You can also set it in the interactive **Config** menu (the *Sync repo* field —
which autocompletes against your GitHub repos as you type: `↑↓` to pick, `Tab`
to complete), via the `LEET_SYNC_REPO` env var, or by hand in `config.json`
(`syncRepo`).

With a repo registered, three commands work with no repo argument:

```sh
leet pull-solutions        # fetch your LeetCode-solved problems missing from the repo and add them
leet mark-solved           # mark problems done LOCALLY from the folders present in the repo
leet sync                  # package the bundled problems (desc + stub + tests) into the repo
```

- **`pull-solutions`** reads your account (needs `leet auth`), finds solved
  problems not yet in the repo, fetches your accepted source, and pushes them.
- **`mark-solved`** is the reverse and needs no LeetCode session: it reads the
  repo's folders, maps each through the NeetCode→LeetCode alias table, and marks
  the matching bundled problems done locally. `--dry-run` previews. It's the same
  resolution `leet import <repo>` uses, just defaulting to your configured repo.
  Folders for problems not in any bundled list are reported and skipped (local
  completion is keyed to bundled-list problems).

The TUI **Sync** menu (Tab → Sync) has the full set:

1. **Authenticate** — grab your LeetCode session from a browser.
2. **Pull solved from LeetCode** — mark done what you've solved on your account.
3. **Mark solved from sync repo** — mark done from the folders in your sync repo.
4. **Pull my solutions → repo** — fetch LeetCode-solved problems missing from
   your sync repo and push them (suspends the TUI, shows live progress, returns
   on any key).
5. **Commit + push solutions dir** — git add/commit/push your local `./solutions`
   files to the repo they live in.
6. **Push solutions to LeetCode** — submit NeetCode solutions to mark Accepted
   (with an in-panel confirm before any real submission).

## Live data

`--live` and `refresh` query LeetCode's public GraphQL endpoint
(`https://leetcode.com/graphql`) for current metadata and problem statements.
No login or session cookie is required — only public data is read. Network
failures degrade gracefully to the bundled data.

## Project layout

```
src/
  types.ts            shared Problem / ProblemList types
  parse.ts            slugify + raw-list parser (LeetCode's slug scheme)
  lib.ts              load / filter / sort / find over embedded + downloaded lists
  lists.generated.ts  bundled lists embedded into the binary (from gen-embed.ts)
  leetcode.ts         public GraphQL client (fetch one / many, bounded concurrency)
  leetcode-progress.ts authenticated "my solved problems" fetch (session cookie)
  leetcode-submit.ts  authenticated submit + judge polling (retry/backoff)
  leetcode-submissions.ts authenticated submission-source fetch (pull-solutions)
  pull-solutions.ts   add LeetCode-solved problems missing from your sync repo
  auth.ts             grab the session cookie from a local browser
  chrome-cookies.ts   decrypt Chrome's cookie store (Keychain-derived key)
  firefox-cookies.ts  read Firefox's plaintext cookie store
  progress.ts         completion tracking (completed.json outside the repo)
  config.ts           user settings + LeetCode session (config.json)
  adapters.ts         import adapters (NeetCode layout, LeetCode account)
  import.ts           source acquisition + slug resolution against bundled lists
  recommend.ts        modular "recommended problems" ranking strategies
  description.ts      resolve a statement cache-first (cache → repo .md → live)
  scaffold.ts         C++ solution file scaffolding
  harness.ts          generate the embedded C++ test harness
  runner.ts           compile + run a solution, capture output (Logs panel)
  cache.ts / repo.ts / prefetch.ts   local solution cache + repo/live prefetch
  setup.ts            proactive study-set pre-caching
  sync.ts             package problems into a GitHub repo (leet sync)
  package.ts          per-problem artifacts (md / cpp / tests) for sync
  render.ts           table + single-problem rendering, minimal HTML->text
  tui.ts              interactive four-panel browser (raw-mode input, live preview)
  cli.ts              argument parsing and command dispatch
scripts/
  build-data.ts       parse data/raw/*.txt into data/*.json
  gen-embed.ts        regenerate src/lists.generated.ts from data/*.json
  gen-formula.ts      render the Homebrew formula from a release's checksums
  setup.ts            postinstall / `bun run setup` pre-cache entry point
.github/workflows/
  release.yml         build + attach cross-platform binaries on v* tags
data/
  raw/*.txt           source lists in the raw pasted format
  *.json              generated, bundled problem data
```

Regenerate the bundled JSON (and the embedded copy) after editing `data/raw/*.txt`:

```sh
bun run build:data      # parse raw → json, then re-embed
```

## Tests

```sh
bun test
```

184 tests covering the pure logic (slugify, parsing, filtering, sorting, TUI
layout/rendering, recommendation ranking, cookie decryption) and the network
layers with injected fetches (submit retry/backoff, solved-set pagination). The
live GraphQL and browser/Keychain paths are isolated so unit tests never hit the
network or your machine's real cookies.
