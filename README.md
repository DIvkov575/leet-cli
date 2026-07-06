# leet-cli

Browse bundled LeetCode company problem lists from the terminal, with optional
live refresh from LeetCode's public GraphQL API. Built with [Bun](https://bun.sh)
(native TypeScript, no build step).

## Install

```sh
bun install          # no runtime deps, but sets up the workspace
bun link             # optional: exposes `leet` on your PATH
# or just run directly:
bun run src/cli.ts <command>
```

Compile a standalone binary:

```sh
bun run compile      # produces ./leet
```

## Bundled lists

| Name     | Problems | Source            |
|----------|----------|-------------------|
| `uber`   | 361      | Uber-tagged set   |
| `nvidia` | 138      | NVIDIA-tagged set |
| `set-1`  | 46       | Assorted set 1    |
| `set-2`  | 89       | Assorted set 2    |

Each problem carries its number, title, slug, URL, acceptance rate, and difficulty.

## Usage

```sh
leet lists                       # list the bundled problem lists
leet tui <list>                  # browse a list interactively (see below)
leet ls <list> [filters]         # print a list as a table
leet show <id|slug> [--live]     # show one problem (--live fetches the statement)
leet open <id|slug> [list]       # open a problem in the browser
leet random [list] [filters]     # print one random problem
leet done [id|slug ...]          # mark problems done, or list what's done
leet undone <id|slug ...>        # unmark problems as done
leet import <path|owner/repo>    # mark done from an external source (e.g. NeetCode)
leet refresh <list|--all>        # refresh acceptance/difficulty from LeetCode
```

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

## Interactive mode (`leet tui`)

`leet tui <list>` opens a full-screen browser that redraws on every keystroke.
The layout adapts to the terminal size — columns are computed to fit the width
(long titles truncate with `…` rather than wrapping), and on terminals ≥ 90
columns a live problem-preview pane appears beside the list.

| Key            | Action                                            |
|----------------|---------------------------------------------------|
| `↑`/`↓`, `j`/`k` | move the cursor (or scroll the preview when focused) |
| `g` / `G`      | jump to top / bottom                              |
| PgUp / PgDn    | page up / down                                    |
| `Space`        | toggle done for the selected problem (saved immediately) |
| `f`            | cycle the done filter: all → todo → done          |
| `d`            | cycle difficulty: any → Easy → Medium → Hard      |
| `/`            | search by title (Enter to apply, Esc to clear)    |
| `Tab`          | move focus between the list and the preview pane  |
| `Enter`        | load the live problem statement into the preview  |
| `o`            | open the selected problem in the browser          |
| `q` / Ctrl-C   | quit (restores the terminal)                      |

The preview fetches the statement lazily from LeetCode's public GraphQL API the
first time you `Enter`/`Tab` into it, so browsing stays offline until you ask.

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
