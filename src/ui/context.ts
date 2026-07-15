/**
 * Shared runtime context for the TUI. `runTui` builds one of these, hands it to
 * `createActions` (which mutate `state` and repaint via `render`) and
 * `createInputHandler` (which maps keys to actions). Keeping the shared mutable
 * refs in one object is what lets the actions and the input handler live in
 * separate modules instead of one giant closure.
 */
import type { Config } from "../config.ts";
import type { Recommendation } from "../recommend.ts";
import type { State } from "./state.ts";

export interface TuiContext {
  /** The single mutable UI state. */
  state: State;
  /** Repaint the current frame. */
  render: () => void;
  /** The output stream (for size + alt-screen control sequences). */
  out: NodeJS.WriteStream;
  /** Config loaded at startup — used for the roadmap's default chart/subset. */
  config: Config;
  /** Re-rank ★ Recommended for a config + completed set (used on config close). */
  rankRecommended: (cfg: Config, done: Set<number>) => Recommendation[];
  /**
   * The active stdin key handler. `runTui` sets this after building it; actions
   * that hand the terminal to a child process (runLeetInShell, editor) detach
   * and re-attach it through this ref so the child owns stdin cleanly.
   */
  onData: ((buf: Buffer) => void) | null;
  /** Tear down listeners + alt-screen and resolve runTui. Set by `runTui`. */
  finish: () => void;
}
