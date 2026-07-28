import { describe, expect, test } from "bun:test";
import { parseTuiLaunchSettings } from "../../src/cli/commands/args";

describe("TUI launch settings", () => {
  test("finds the panel without treating flags as commands", () => {
    expect(
      parseTuiLaunchSettings(["--no-alt-screen", "--scroll-step", "3", "chat", "--no-mouse"])
    ).toEqual({
      command: "chat",
      alternateScreen: false,
      mouse: false,
      scrollStep: 3,
    });

    expect(parseTuiLaunchSettings(["--no-alt-screen"])).toEqual({
      command: undefined,
      alternateScreen: false,
    });
  });

  test("uses the last explicit terminal-mode flag", () => {
    expect(
      parseTuiLaunchSettings(["chat", "--no-alt-screen", "--alt-screen", "--no-mouse", "--mouse"])
    ).toEqual({
      command: "chat",
      alternateScreen: true,
      mouse: true,
    });
  });

  test("normalizes inline transcript scroll overrides", () => {
    expect(parseTuiLaunchSettings(["chat", "--scroll-step=99"])).toEqual({
      command: "chat",
      scrollStep: 8,
    });
    expect(parseTuiLaunchSettings(["--scroll-step", "invalid", "chat"])).toEqual({
      command: "chat",
    });
    expect(parseTuiLaunchSettings(["--scroll-step", "--no-mouse", "chat"])).toEqual({
      command: "chat",
      mouse: false,
    });
  });
});
