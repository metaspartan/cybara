import { describe, expect, test } from "bun:test";
import {
  completeTUIChatCommand,
  matchingTUIChatCommands,
  nextTUIChatCommandIndex,
} from "../../src/cli/tui/commands";

describe("CLI TUI command palette", () => {
  test("filters commands only while entering a command name", () => {
    expect(matchingTUIChatCommands("/di").map((command) => command.name)).toEqual([
      "/diff",
      "/diffs",
    ]);
    expect(matchingTUIChatCommands("explain /di")).toEqual([]);
    expect(matchingTUIChatCommands("/diff now")).toEqual([]);
  });

  test("completes the selected command without executing it", () => {
    expect(completeTUIChatCommand("/di", 1)).toBe("/diffs ");
    expect(completeTUIChatCommand("/diff", 0)).toBeNull();
    expect(completeTUIChatCommand("plain text", 0)).toBeNull();
  });

  test("offers transcript recovery and terminal utility commands", () => {
    expect(matchingTUIChatCommands("/se").map((command) => command.name)).toContain("/search");
    expect(matchingTUIChatCommands("/ex").map((command) => command.name)).toEqual([
      "/export",
      "/expand",
      "/exit",
    ]);
    expect(matchingTUIChatCommands("/terminal").map((command) => command.name)).toEqual([
      "/terminal-info",
    ]);
  });

  test("wraps keyboard selection in both directions", () => {
    expect(nextTUIChatCommandIndex(0, -1, 3)).toBe(2);
    expect(nextTUIChatCommandIndex(2, 1, 3)).toBe(0);
    expect(nextTUIChatCommandIndex(4, 1, 0)).toBe(0);
  });
});
