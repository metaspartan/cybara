import { describe, expect, test } from "bun:test";
import {
  clipboardCandidates,
  composerWindow,
  resolveTerminalLayout,
} from "../../src/cli-tui-terminal";

describe("CLI TUI terminal behavior", () => {
  test("adapts controls and content density to terminal dimensions", () => {
    const narrow = resolveTerminalLayout(52, 20);
    const wide = resolveTerminalLayout(140, 60);
    expect(narrow.narrow).toBe(true);
    expect(narrow.composerLines).toBe(3);
    expect(narrow.commandRows).toBe(4);
    expect(narrow.transcriptMessages).toBe(1);
    expect(narrow.messageLines).toBe(4);
    expect(wide.narrow).toBe(false);
    expect(wide.compact).toBe(false);
    expect(wide.composerLines).toBeGreaterThan(narrow.composerLines);
    expect(wide.transcriptMessages).toBeGreaterThan(narrow.transcriptMessages);
  });

  test("keeps the cursor line visible in bounded multiline prompts", () => {
    const input = ["one", "two", "three", "four", "five", "six"].join("\n");
    const cursor = input.indexOf("four") + 2;
    const visible = composerWindow(input, cursor, 3);
    expect(visible).toHaveLength(3);
    expect(visible.join("\n")).toContain("▏");
    expect(visible.join("\n").replace("▏", "")).toContain("four");
  });

  test("selects native clipboard helpers without invoking a shell", () => {
    expect(clipboardCandidates("darwin", {})).toEqual([["pbcopy"]]);
    expect(clipboardCandidates("win32", {})).toEqual([["clip.exe"], ["clip"]]);
    expect(clipboardCandidates("linux", { WAYLAND_DISPLAY: "wayland-0" })[0]).toEqual(["wl-copy"]);
    expect(clipboardCandidates("linux", {}).at(-1)).toEqual(["xsel", "--clipboard", "--input"]);
  });
});
