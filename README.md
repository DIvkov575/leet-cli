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
| `recommend`    | —                    | picker's Recommended panel | `popularity` (or `acceptance`) |

```sh
leet config                          # show all settings
leet config editor "code -w"         # set the editor
leet config recommend acceptance     # change the recommendation ranking
leet config cxx --unset              # clear a setting
```

The `recommend` strategy is modular — `popularity` ranks by how many company
lists a problem appears in (most-asked first); `acceptance` ranks the most
approachable unsolved problems first.

Inside the interactive browser, open the settings screen with **`c`** (from the
list picker on launch, or the **Config** menu item). Enter edits the selected
field, `x` clears it, Esc saves and closes.

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
to use the tool, and a front-end for everything the subcommands do. Running it
bare opens a **list picker** first (no list is silently assumed); pass
`leet tui <list>` to jump straight into one. The picker shows each list's
done/left/total counts, and on wide terminals a **Recommended** panel beside it
surfaces the highest-signal unsolved problems (ranking set by `recommend` in
config).

Every action lives in a **menu bar** across the top, so nothing has to be
memorized: **Tab** / **Shift-Tab** move between menu items and **Enter** fires
the highlighted one (Filter · Difficulty · Sort · Search · List · Open ·
Refresh · Import · Help). The arrow keys keep scrolling the list even while the
menu is focused. The view adapts to the terminal size — columns are computed to
fit the width (long titles truncate with `…` rather than wrapping), difficulty
is color-coded (green/yellow/red), and on terminals ≥ 90 columns a live
problem-preview pane appears beside the list.

Core keys:

| Key              | Action                                            |
|------------------|---------------------------------------------------|
| `↑`/`↓`, `j`/`k` | move the cursor (scroll the preview when focused) |
| `g` / `G`        | jump to top / bottom · PgUp/PgDn page             |
| `Enter`          | preview the selected problem                      |
| `Space`          | toggle done (saved immediately)                   |
| `Tab` / Shift-Tab | focus / move through the menu bar                |
| `Esc`            | leave the menu / preview, clear messages          |
| `q` / Ctrl-C     | quit (restores the terminal)                      |

Each menu item also has a direct shortcut for muscle memory: `f` filter, `d`
difficulty, `s` sort, `/` search, `r` random, `L` list, `o` open, `R` refresh,
`i` import, `?` help. Press `?` in-app for the full reference.

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
