# leet-cli

Browse bundled LeetCode company problem lists from the terminal, with optional
live refresh from LeetCode's public GraphQL API. Built with [Bun](https://bun.sh)
(native TypeScript, no build step).

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
leet done [id|slug ...]          # mark problems done, or list what's done
leet undone <id|slug ...>        # unmark problems as done
leet import <path|owner/repo>    # mark done from an external source (e.g. NeetCode)
leet refresh <list|--all>        # refresh acceptance/difficulty from LeetCode
leet config [key value|--unset]  # show or set settings (editor, solutionsDir, cxx)
```

## Configuration

Settings persist to `config.json` in the data dir (`$XDG_DATA_HOME/leet-cli`, or
`~/.local/share/leet-cli`). Each is optional and layers over the matching
environment variable, then a built-in default:

| Key            | Overrides            | Used by             | Default              |
|----------------|----------------------|---------------------|----------------------|
| `editor`       | `$VISUAL`/`$EDITOR`  | `solve -o`          | nvim/vim/vi if found |
| `solutionsDir` | —                    | `solve` / `test`    | `solutions`          |
| `cxx`          | `$CXX`               | `test`              | `c++`                |
| `recommend`    | —                    | ★ Recommended list  | `popularity` (or `acceptance`) |

```sh
leet config                          # show all settings
leet config editor "code -w"         # set the editor
leet config recommend acceptance     # change the recommendation ranking
leet config cxx --unset              # clear a setting
```

The `recommend` strategy is modular — `popularity` ranks by how many company
lists a problem appears in (most-asked first); `acceptance` ranks the most
approachable unsolved problems first.

Inside the interactive browser, open the settings screen with **`c`** (from any
panel, or the **Config** menu item). Enter edits the selected field, `x` clears
it, Esc saves and closes.

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

- **Lists** — every bundled list with done/left/total counts, plus a
  **★ Recommended** pseudo-list at the top that surfaces the highest-signal
  unsolved problems across all lists (ranking set by `recommend` in config).
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

Every action also lives in a **menu bar** across the top — press **Tab** to
enter it, `←→` to move, `Enter` to fire (Filter · Difficulty · Sort · Search ·
List · Open · Refresh · Import · Config · Help); `Esc` returns to your panel.
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
| `Tab`            | enter the menu bar                                |
| `q` / Ctrl-C     | quit (restores the terminal)                      |

Each menu item also has a direct shortcut, usable from any panel: `f` filter,
`d` difficulty, `S` sort, `/` search, `r` random, `L` lists, `o` open, `R`
refresh, `i` import, `c` config, `?` help. `s` is reserved for **solve** on the
Problems/Preview panels. Press `?` in-app for the full reference.

The preview fetches the statement lazily from LeetCode's public GraphQL API the
first time you open it, so browsing stays offline until you ask. The one-shot
subcommands below remain available for scripting and piping.

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

## Live data

`--live` and `refresh` query LeetCode's public GraphQL endpoint
(`https://leetcode.com/graphql`) for current metadata and problem statements.
No login or session cookie is required — only public data is read. Network
failures degrade gracefully to the bundled data.

## Project layout

```
src/
  types.ts      shared Problem / ProblemList types
  parse.ts      slugify + raw-list parser (LeetCode's slug scheme)
  lib.ts        load / filter / sort / find — the reusable library surface
  leetcode.ts   public GraphQL client (fetch one / many with bounded concurrency)
  progress.ts   completion tracking (completed.json outside the repo)
  adapters.ts   import adapters (NeetCode sync layout + slug alias maps)
  import.ts     source acquisition (local path / GitHub via gh) + slug resolution
  render.ts     table + single-problem terminal rendering, minimal HTML->text
  tui.ts        interactive full-screen browser (raw-mode input, live preview)
  cli.ts        argument parsing and command dispatch
scripts/
  build-data.ts parse data/raw/*.txt into data/*.json
data/
  raw/*.txt     source lists in the raw pasted format
  *.json        generated, bundled problem data
```

Regenerate the bundled JSON after editing `data/raw/*.txt`:

```sh
bun run build:data
```

## Tests

```sh
bun test
```

Covers slug generation, raw parsing, filtering, and sorting. The live GraphQL
path is isolated in `leetcode.ts` so unit tests never hit the network.
