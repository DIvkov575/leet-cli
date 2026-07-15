/**
 * The TUI's raw-mode key handler. `createInputHandler(ctx, actions)` returns the
 * `onData` callback wired to stdin: it reads the current focus/overlay off the
 * shared state and dispatches keys to navigation or to `actions`. Split out of
 * the old `runTui` mega-closure so the (large) key map is isolated.
 */
import { CONFIG_FIELDS, ROADMAP_SUBSETS, resolveRoadmapSubset, toggleSelection } from "../config.ts";
import { NEETCODE_PATTERNS } from "../tags.ts";
import { neetcodeChart, chartMove } from "../roadmap.ts";
import { MENU_ITEMS, PALETTE_ITEMS, type MenuAction } from "./menu.ts";
import { cycleDoneFilter, cycleDifficulty, cycleSortState } from "./controls.ts";
import { previewBody, filterRepoSuggestions, fieldHasRepoSuggest } from "./render.ts";
import { recompute, current, listRows, selectListRow, SYNC_ACTIONS } from "./state.ts";
import type { TuiContext } from "./context.ts";
import type { Actions } from "./actions.ts";

/** Open a URL in the platform browser (fire-and-forget). */
async function openUrl(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited;
}

// A tiny non-crypto PRNG for the "random" jump; self-contained so the test
// environment's Date/Math.random restrictions never come into play.
let prngState = 0x2545f491;
function pseudoRandom(): number {
  prngState ^= prngState << 13;
  prngState ^= prngState >>> 17;
  prngState ^= prngState << 5;
  return ((prngState >>> 0) % 1_000_000) / 1_000_000;
}

export function createInputHandler(ctx: TuiContext, actions: Actions): (buf: Buffer) => void {
  const { state } = ctx;
  const render = () => ctx.render();
  const finish = () => ctx.finish();

  // Menu-bar action dispatch. Toggles cycle in place; overlays open; the
  // outward-facing actions delegate to the async `actions` bag.
  const activateMenu = (action: MenuAction): void => {
    switch (action) {
      case "filter":
        // The bar's Filter opens the combined overlay (status·difficulty·sort·tags).
        state.filterPanel = { index: 0 };
        break;
      case "menu":
        state.palette = { index: 0 };
        break;
      case "diff":
        state.diff = cycleDifficulty(state.diff);
        recompute(state);
        break;
      case "tag":
        state.tagPicker = { index: 0 };
        break;
      case "roadmap":
        state.roadmap = { cursor: 0, subset: resolveRoadmapSubset(ctx.config) };
        break;
      case "sort": {
        const next = cycleSortState(state.sortKey, state.sortDesc);
        state.sortKey = next.key;
        state.sortDesc = next.desc;
        recompute(state);
        break;
      }
      case "search":
        // Focus Problems so the always-visible search bar (which carries the
        // live query) is on screen while typing.
        if (state.focus !== "problems") {
          state.focus = "problems";
          state.lastPanel = "problems";
        }
        state.input = { kind: "search", value: state.search };
        break;
      case "list":
        state.focus = "lists";
        state.lastPanel = "lists";
        break;
      case "open": {
        const p = current(state);
        if (p) void openUrl(p.url);
        break;
      }
      case "refresh":
        void actions.refreshList();
        return;
      case "import":
        state.input = { kind: "import", value: "" };
        break;
      case "sync":
        actions.openSync();
        return;
      case "config":
        void actions.openConfig();
        return;
      case "help":
        state.help = true;
        break;
    }
    render();
  };

  const previewBodyLen = (): number => previewBody(state, ctx.out.columns ?? 80).length;
  const pageStep = (): number => Math.max(1, (ctx.out.rows ?? 24) - 4);
  const invalidateStalePreview = (): void => {
    const p = current(state);
    if (p && state.preview.slug !== p.slug && state.focus !== "preview") {
      state.preview = { slug: null, status: "idle", text: "", scroll: 0 };
    }
    if (p && state.logs.slug !== p.slug && state.focus !== "logs") {
      state.logs = { slug: null, status: "idle", lines: [], scroll: 0 };
    }
  };

  return function onData(buf: Buffer): void {
    const key = buf.toString("utf8");

    // ── text prompt mode (search / import) ──
    if (state.input) {
      if (key === "\r" || key === "\n") {
        const { kind, value } = state.input;
        state.input = null;
        if (kind === "import" && value.trim()) void actions.runImport(value.trim());
      } else if (key === "\x1b") {
        if (state.input.kind === "search") {
          state.search = "";
          recompute(state);
        }
        state.input = null;
      } else if (key === "\x7f" || key === "\b") {
        state.input.value = state.input.value.slice(0, -1);
        if (state.input.kind === "search") {
          state.search = state.input.value;
          recompute(state);
        }
      } else if (key === "\x03") {
        finish();
        return;
      } else if (key >= " " && !key.startsWith("\x1b")) {
        state.input.value += key;
        if (state.input.kind === "search") {
          state.search = state.input.value;
          recompute(state);
        }
      }
      render();
      return;
    }

    // ── config overlay ── (takes priority; can open over the picker)
    if (state.config) {
      const cfg = state.config;
      const field = CONFIG_FIELDS[cfg.index]!;

      if (cfg.picker) {
        const pick = cfg.picker;
        switch (key) {
          case "\x03":
            finish();
            return;
          case "q":
          case "\x1b":
            cfg.picker = null;
            break;
          case "k":
          case "\x1b[A":
            pick.index = Math.max(0, pick.index - 1);
            break;
          case "j":
          case "\x1b[B":
            pick.index = Math.min(pick.choices.length - 1, pick.index + 1);
            break;
          case " ":
          case "\r":
          case "\n": {
            const name = pick.choices[pick.index];
            if (name) {
              const next = toggleSelection(cfg.working[pick.key] as string[] | undefined, name);
              if (next.length > 0) (cfg.working[pick.key] as string[]) = next;
              else delete cfg.working[pick.key];
            }
            break;
          }
          case "a": // all included — exclude nothing (the default)
            delete cfg.working[pick.key];
            break;
          case "n": // none included — exclude every list
            (cfg.working[pick.key] as string[]) = [...pick.choices];
            break;
        }
        render();
        return;
      }

      if (cfg.editing) {
        const suggests = fieldHasRepoSuggest(field)
          ? filterRepoSuggestions(cfg.repoSuggestions, cfg.draft)
          : [];
        if (key === "\r" || key === "\n") {
          const v = cfg.draft.trim();
          if (v) (cfg.working[field.key] as string) = v;
          else delete cfg.working[field.key];
          cfg.editing = false;
        } else if (key === "\x1b") {
          cfg.editing = false; // cancel edit, keep prior value
        } else if (suggests.length > 0 && key === "\t") {
          cfg.draft = suggests[Math.min(cfg.suggestIndex, suggests.length - 1)]!;
          cfg.suggestIndex = 0;
        } else if (suggests.length > 0 && (key === "\x1b[A" || key === "\x1b[B")) {
          const dir = key === "\x1b[A" ? -1 : 1;
          cfg.suggestIndex = (cfg.suggestIndex + dir + suggests.length) % suggests.length;
        } else if (key === "\x7f" || key === "\b") {
          cfg.draft = cfg.draft.slice(0, -1);
          cfg.suggestIndex = 0;
        } else if (key === "\x03") {
          finish();
          return;
        } else if (key >= " " && !key.startsWith("\x1b")) {
          cfg.draft += key;
          cfg.suggestIndex = 0;
        }
        render();
        return;
      }
      switch (key) {
        case "\x03":
          finish();
          return;
        case "q":
        case "\x1b":
          void actions.closeConfig();
          return;
        case "k":
        case "\x1b[A":
          cfg.index = Math.max(0, cfg.index - 1);
          break;
        case "j":
        case "\x1b[B":
          cfg.index = Math.min(CONFIG_FIELDS.length - 1, cfg.index + 1);
          break;
        case "x":
        case "\x7f":
          delete cfg.working[field.key];
          break;
        case "\r":
        case "\n":
          if (field.kind === "multiselect") {
            cfg.picker = { key: field.key, choices: [...state.listNames], index: 0 };
          } else if (field.kind === "boolean") {
            if (cfg.working[field.key]) delete cfg.working[field.key];
            else (cfg.working[field.key] as boolean) = true;
          } else {
            cfg.editing = true;
            cfg.draft = (cfg.working[field.key] as string | undefined) ?? "";
          }
          break;
      }
      render();
      return;
    }

    // ── combined Filter overlay ── (status · difficulty · sort · tags · clear)
    if (state.filterPanel) {
      const fp = state.filterPanel;
      const applyLeftRight = (dir: 1 | -1): void => {
        // Left/right cycle the value on the focused row (right = forward).
        switch (fp.index) {
          case 0:
            state.doneFilter = cycleDoneFilter(state.doneFilter, dir);
            break;
          case 1:
            state.diff = cycleDifficulty(state.diff, dir);
            break;
          case 2: {
            const next = cycleSortState(state.sortKey, state.sortDesc, dir);
            state.sortKey = next.key;
            state.sortDesc = next.desc;
            break;
          }
        }
        recompute(state);
      };
      switch (key) {
        case "\x03":
          finish();
          return;
        case "\x1b":
        case "\r":
        case "\n":
        case "q":
          state.filterPanel = null;
          break;
        case "k":
        case "\x1b[A":
          fp.index = Math.max(0, fp.index - 1);
          break;
        case "j":
        case "\x1b[B":
          fp.index = Math.min(4, fp.index + 1);
          break;
        case "h":
        case "\x1b[D":
          if (fp.index <= 2) applyLeftRight(-1);
          break;
        case "l":
        case "\x1b[C":
          if (fp.index <= 2) applyLeftRight(1);
          break;
        case " ":
          // Space cycles a value row, or activates the action rows (tags/clear).
          if (fp.index <= 2) applyLeftRight(1);
          else if (fp.index === 3) {
            state.filterPanel = null;
            state.tagPicker = { index: 0 };
          } else if (fp.index === 4) {
            state.doneFilter = "all";
            state.diff = undefined;
            state.tagFilter.clear();
            recompute(state);
          }
          break;
        case "x":
          state.doneFilter = "all";
          state.diff = undefined;
          state.tagFilter.clear();
          recompute(state);
          break;
        default:
          return;
      }
      render();
      return;
    }

    // ── command palette overlay ── (the "Menu" item: everything not on the bar)
    if (state.palette) {
      const pal = state.palette;
      switch (key) {
        case "\x03":
          finish();
          return;
        case "\x1b":
        case "q":
          state.palette = null;
          break;
        case "k":
        case "\x1b[A":
          pal.index = Math.max(0, pal.index - 1);
          break;
        case "j":
        case "\x1b[B":
          pal.index = Math.min(PALETTE_ITEMS.length - 1, pal.index + 1);
          break;
        case "\r":
        case "\n": {
          const item = PALETTE_ITEMS[pal.index]!;
          state.palette = null;
          activateMenu(item.action);
          return;
        }
        default:
          return;
      }
      render();
      return;
    }

    // ── tag-picker overlay ── (checklist of NeetCode patterns)
    if (state.tagPicker) {
      const tp = state.tagPicker;
      const patterns = NEETCODE_PATTERNS;
      switch (key) {
        case "\x03":
          finish();
          return;
        case "\x1b":
        case "\r":
        case "\n":
        case "q":
          state.tagPicker = null;
          recompute(state);
          break;
        case "k":
        case "\x1b[A":
          tp.index = Math.max(0, tp.index - 1);
          break;
        case "j":
        case "\x1b[B":
          tp.index = Math.min(patterns.length - 1, tp.index + 1);
          break;
        case " ": {
          const pat = patterns[tp.index]!;
          if (state.tagFilter.has(pat)) state.tagFilter.delete(pat);
          else state.tagFilter.add(pat);
          recompute(state);
          break;
        }
        case "a":
          for (const p of patterns) state.tagFilter.add(p);
          recompute(state);
          break;
        case "n":
          state.tagFilter.clear();
          recompute(state);
          break;
        default:
          return;
      }
      render();
      return;
    }

    // ── roadmap overlay ── (box flowchart; Enter studies a pattern) ──
    if (state.roadmap) {
      const rm = state.roadmap;
      const chart = neetcodeChart();
      const flat = chart.rows.flat();
      switch (key) {
        case "\x03":
          finish();
          return;
        case "\x1b":
        case "q":
          state.roadmap = null;
          break;
        case "k":
        case "\x1b[A":
          rm.cursor = chartMove(chart, rm.cursor, "up");
          break;
        case "j":
        case "\x1b[B":
          rm.cursor = chartMove(chart, rm.cursor, "down");
          break;
        case "h":
        case "\x1b[D":
          rm.cursor = chartMove(chart, rm.cursor, "left");
          break;
        case "l":
        case "\x1b[C":
          rm.cursor = chartMove(chart, rm.cursor, "right");
          break;
        case "\t":
        case "\x1b[Z": {
          const i = ROADMAP_SUBSETS.indexOf(rm.subset);
          const dir = key === "\t" ? 1 : -1;
          rm.subset = ROADMAP_SUBSETS[(i + dir + ROADMAP_SUBSETS.length) % ROADMAP_SUBSETS.length]!;
          break;
        }
        case "\r":
        case "\n": {
          const node = flat[rm.cursor];
          if (node) {
            state.tagFilter = new Set([node.pattern]);
            state.roadmap = null;
            state.focus = "problems";
            state.lastPanel = "problems";
            state.cursor = 0;
            state.top = 0;
            recompute(state);
          }
          break;
        }
        default:
          return;
      }
      render();
      return;
    }

    // ── sync overlay ──
    if (state.sync) {
      const sync = state.sync;
      // Push confirmation gate: y submits, n/Esc cancels.
      if (sync.confirmPush !== null) {
        if (key === "y" || key === "Y") {
          void actions.syncPushRun();
        } else if (key === "n" || key === "N" || key === "\x1b") {
          sync.confirmPush = null;
          sync.lines.push("push cancelled.");
        } else if (key === "\x03") {
          finish();
          return;
        }
        render();
        return;
      }
      // Generic confirmation gate for the git actions: y runs, n/Esc cancels.
      if (sync.confirm) {
        if (key === "y" || key === "Y") {
          const action = sync.confirm.action;
          sync.confirm = null;
          if (action === "pullSolutions") void actions.syncPullSolutions();
          else if (action === "pushDir") void actions.syncPushDir();
        } else if (key === "n" || key === "N" || key === "\x1b") {
          sync.confirm = null;
          sync.lines.push("cancelled.");
        } else if (key === "\x03") {
          finish();
          return;
        }
        render();
        return;
      }
      if (key === "\x03") {
        finish();
        return;
      }
      if (sync.busy) return; // while an action runs, only Ctrl-C (handled above)
      switch (key) {
        case "q":
        case "\x1b":
          state.sync = null;
          break;
        case "k":
        case "\x1b[A":
          sync.index = Math.max(0, sync.index - 1);
          break;
        case "j":
        case "\x1b[B":
          sync.index = Math.min(SYNC_ACTIONS.length - 1, sync.index + 1);
          break;
        case "\r":
        case "\n":
          actions.runSyncAction(SYNC_ACTIONS[sync.index]!.key);
          return;
      }
      render();
      return;
    }

    // ── help overlay ──
    if (state.help) {
      if (key === "?" || key === "\x1b" || key === "q") state.help = false;
      render();
      return;
    }

    // ── fullscreen reading mode ── (owns all input while active)
    if (state.fullscreen) {
      const maxLogScroll = Math.max(0, state.logs.lines.length - 1);
      switch (key) {
        case "\x03":
        case "q":
          finish();
          return;
        case "F":
        case "\x1b":
        case "\x1b[D":
          state.fullscreen = false;
          break;
        case "\t":
        case "\x1b[Z":
          state.focus = state.focus === "logs" ? "preview" : "logs";
          state.lastPanel = state.focus;
          break;
        case "k":
        case "\x1b[A":
          if (state.focus === "logs") state.logs.scroll = Math.max(0, state.logs.scroll - 1);
          else state.preview.scroll = Math.max(0, state.preview.scroll - 1);
          break;
        case "j":
        case "\x1b[B":
          if (state.focus === "logs") state.logs.scroll = Math.min(maxLogScroll, state.logs.scroll + 1);
          else state.preview.scroll = Math.min(Math.max(0, previewBodyLen() - 1), state.preview.scroll + 1);
          break;
        case "\x1b[5~":
          if (state.focus === "logs") state.logs.scroll = Math.max(0, state.logs.scroll - pageStep());
          else state.preview.scroll = Math.max(0, state.preview.scroll - pageStep());
          break;
        case "\x1b[6~":
          if (state.focus === "logs") state.logs.scroll = Math.min(maxLogScroll, state.logs.scroll + pageStep());
          else state.preview.scroll = Math.min(Math.max(0, previewBodyLen() - 1), state.preview.scroll + pageStep());
          break;
        case "g":
          if (state.focus === "logs") state.logs.scroll = 0;
          else state.preview.scroll = 0;
          break;
        case "G":
          if (state.focus === "logs") state.logs.scroll = maxLogScroll;
          else state.preview.scroll = Math.max(0, previewBodyLen() - 1);
          break;
        case " ":
          void actions.toggleDone();
          return;
        case "s":
          void actions.solveCurrent();
          return;
        case "t":
          void actions.runTest();
          return;
        case "u":
          void actions.submitCurrent();
          return;
        case "o": {
          const p = current(state);
          if (p) void openUrl(p.url);
          break;
        }
        default:
          return;
      }
      render();
      return;
    }

    // ── first-run suggestion is modal-lite ──
    if (state.suggestSetup) {
      if (key === "\x03") {
        finish();
        return;
      }
      if (key === "P" || key === "p") {
        void actions.acceptSetup();
        return;
      }
      void actions.dismissSetup(); // then fall through to handle the key normally
    }

    // Ctrl-C always quits (except while typing, handled above).
    if (key === "\x03") {
      finish();
      return;
    }

    // ── Tab / Shift-Tab: enter/cycle the menu bar ──
    if (key === "\t" || key === "\x1b[Z") {
      if (state.focus !== "menu") {
        state.lastPanel = state.focus;
        state.focus = "menu";
      } else {
        const dir = key === "\t" ? 1 : -1;
        state.menuIndex = (state.menuIndex + dir + MENU_ITEMS.length) % MENU_ITEMS.length;
      }
      render();
      return;
    }

    // ── menu focus ──
    if (state.focus === "menu") {
      switch (key) {
        case "q":
          finish();
          return;
        case "\x1b":
          state.focus = state.lastPanel;
          break;
        case "h":
        case "\x1b[D":
          state.menuIndex = (state.menuIndex - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
          break;
        case "l":
        case "\x1b[C":
          state.menuIndex = (state.menuIndex + 1) % MENU_ITEMS.length;
          break;
        case "\r":
        case "\n":
          activateMenu(MENU_ITEMS[state.menuIndex]!.action);
          return;
        default:
          return;
      }
      render();
      return;
    }

    // Direct accelerators (menu items) work from any panel. `s` is NOT here —
    // it's the contextual "solve" action; sort is on `S` to avoid shadowing it.
    const accel: Record<string, MenuAction> = {
      f: "filter",
      d: "diff",
      T: "tag",
      m: "roadmap",
      S: "sort",
      "/": "search",
      L: "list",
      R: "refresh",
      i: "import",
      c: "config",
      "?": "help",
    };
    if (accel[key]) {
      activateMenu(accel[key]!);
      invalidateStalePreview();
      return;
    }

    // ── Lists panel ──
    if (state.focus === "lists") {
      const rows = listRows(state);
      switch (key) {
        case "q":
          finish();
          return;
        case "k":
        case "\x1b[A":
          state.listCursor = Math.max(0, state.listCursor - 1);
          break;
        case "j":
        case "\x1b[B":
          state.listCursor = Math.min(rows.length - 1, state.listCursor + 1);
          break;
        case "g":
          state.listCursor = 0;
          break;
        case "G":
          state.listCursor = rows.length - 1;
          break;
        case "\r":
        case "\n":
        case "\x1b[C":
        case "l": {
          const name = rows[state.listCursor]!;
          void selectListRow(state, name).then(() => {
            state.focus = "problems";
            state.lastPanel = "problems";
            render();
          });
          return;
        }
        default:
          return;
      }
      render();
      return;
    }

    // ── Problems panel ──
    if (state.focus === "problems") {
      switch (key) {
        case "q":
          finish();
          return;
        case "k":
        case "\x1b[A":
          state.cursor = Math.max(0, state.cursor - 1);
          invalidateStalePreview();
          break;
        case "j":
        case "\x1b[B":
          state.cursor = Math.min(state.filtered.length - 1, state.cursor + 1);
          invalidateStalePreview();
          break;
        case "\x1b[5~":
          state.cursor = Math.max(0, state.cursor - pageStep());
          invalidateStalePreview();
          break;
        case "\x1b[6~":
          state.cursor = Math.min(state.filtered.length - 1, state.cursor + pageStep());
          invalidateStalePreview();
          break;
        case "g":
          state.cursor = 0;
          invalidateStalePreview();
          break;
        case "G":
          state.cursor = Math.max(0, state.filtered.length - 1);
          invalidateStalePreview();
          break;
        case "\x1b":
        case "\x1b[D":
        case "h":
          state.focus = "lists";
          state.lastPanel = "lists";
          break;
        case "\r":
        case "\n":
        case "\x1b[C":
          state.focus = "preview";
          state.lastPanel = "preview";
          void actions.loadPreview();
          return;
        case " ":
          void actions.toggleDone();
          return;
        case "s":
          void actions.solveCurrent();
          return;
        case "o": {
          const p = current(state);
          if (p) void openUrl(p.url);
          break;
        }
        case "r":
          state.cursor =
            state.filtered.length > 0 ? Math.floor(pseudoRandom() * state.filtered.length) : 0;
          state.status = "";
          invalidateStalePreview();
          break;
        case "p":
          state.focus = "preview";
          state.lastPanel = "preview";
          void actions.loadPreview();
          return;
        case "t":
          void actions.runTest();
          return;
        case "u":
          void actions.submitCurrent();
          return;
        case "F":
          state.focus = "preview";
          state.lastPanel = "preview";
          state.fullscreen = true;
          void actions.loadPreview();
          return;
        case "P":
          actions.startPrefetch();
          return;
        default:
          return;
      }
      render();
      return;
    }

    // ── Preview panel ──
    if (state.focus === "preview") {
      switch (key) {
        case "q":
          finish();
          return;
        case "\x1b":
        case "\x1b[D":
        case "h":
          state.focus = "problems";
          state.lastPanel = "problems";
          break;
        case "\x1b[C":
        case "l":
        case "\r":
        case "\n":
          state.focus = "logs";
          state.lastPanel = "logs";
          break;
        case "k":
        case "\x1b[A":
          state.preview.scroll = Math.max(0, state.preview.scroll - 1);
          break;
        case "j":
        case "\x1b[B":
          state.preview.scroll = Math.min(Math.max(0, previewBodyLen() - 1), state.preview.scroll + 1);
          break;
        case " ":
          void actions.toggleDone();
          return;
        case "s":
          void actions.solveCurrent();
          return;
        case "t":
          void actions.runTest();
          return;
        case "u":
          void actions.submitCurrent();
          return;
        case "F":
          state.fullscreen = true;
          void actions.loadPreview();
          break;
        case "o": {
          const p = current(state);
          if (p) void openUrl(p.url);
          break;
        }
        default:
          return;
      }
      render();
      return;
    }

    // ── Logs panel ──
    if (state.focus === "logs") {
      const maxScroll = Math.max(0, state.logs.lines.length - 1);
      switch (key) {
        case "q":
          finish();
          return;
        case "\x1b":
        case "\x1b[D":
        case "h":
          state.focus = "preview";
          state.lastPanel = "preview";
          break;
        case "k":
        case "\x1b[A":
          state.logs.scroll = Math.max(0, state.logs.scroll - 1);
          break;
        case "j":
        case "\x1b[B":
          state.logs.scroll = Math.min(maxScroll, state.logs.scroll + 1);
          break;
        case "g":
          state.logs.scroll = 0;
          break;
        case "G":
          state.logs.scroll = maxScroll;
          break;
        case "t":
          void actions.runTest();
          return;
        case "u":
          void actions.submitCurrent();
          return;
        case "s":
          void actions.solveCurrent();
          return;
        case "F":
          state.fullscreen = true;
          void actions.loadPreview();
          break;
        case " ":
          void actions.toggleDone();
          return;
        default:
          return;
      }
      render();
      return;
    }
  };
}
