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
leet ls <list> [filters]         # print a list as a table
leet show <id|slug> [--live]     # show one problem (--live fetches the statement)
leet open <id|slug> [list]       # open a problem in the browser
leet random [list] [filters]     # print one random problem
leet refresh <list|--all>        # refresh acceptance/difficulty from LeetCode
```

### Filters (for `ls` / `random`)

| Flag                | Meaning                                   |
|---------------------|-------------------------------------------|
| `--difficulty, -d`  | `easy` \| `medium` \| `hard`              |
| `--min-acc <n>`     | minimum acceptance %                      |
| `--max-acc <n>`     | maximum acceptance %                      |
| `--search, -s <q>`  | title substring match                     |
| `--sort <key>`      | `id` \| `acc` \| `difficulty` \| `title`  |
| `--desc`            | reverse sort order                        |
| `--limit, -n <n>`   | cap the number of rows                    |
| `--json`            | emit JSON instead of a table              |

### Examples

```sh
leet ls nvidia -d hard --sort acc
leet ls uber --search tree --limit 20
leet random uber -d medium
leet show 42 --live
leet refresh nvidia
```

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
  render.ts     table + single-problem terminal rendering, minimal HTML->text
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
