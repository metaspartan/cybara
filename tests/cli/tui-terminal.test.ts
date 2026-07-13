import { describe, expect, test } from "bun:test";
import {
  clipboardCandidates,
  composerWindow,
  resolveTerminalLayout,
  terminalScreenSequence,
  transcriptWindow,
} from "../../src/cli-tui-terminal";

describe("CLI TUI terminal behavior", () => {
  test("adapts controls and content density to terminal dimensions", () => {
    const narrow = resolveTerminalLayout(52, 20);
    const standard = resolveTerminalLayout(80, 24);
    const wide = resolveTerminalLayout(140, 60);
    expect(narrow.narrow).toBe(true);
    expect(narrow.composerLines).toBe(1);
    expect(narrow.commandRows).toBe(4);
    expect(narrow.transcriptMessages).toBe(1);
    expect(narrow.messageLines).toBe(3);
    expect(standard.compact).toBe(true);
    expect(standard.composerLines).toBe(1);
    expect(standard.messageLines).toBe(3);
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

  test("bounds transcript rows without leaking omitted code fences", () => {
    const content = [
      "Intro",
      "```ts",
      "const longValue = 'abcdefghijklmnopqrstuvwxyz';",
      "```",
      "**Result:** complete",
      "Final",
    ].join("\n");
    const visible = transcriptWindow(content, 4, 24);
    expect(visible).toHaveLength(4);
    expect(visible.some((line) => line.hidden)).toBe(true);
    expect(visible.at(-1)?.text).toBe("Final");
    expect(visible.at(-1)?.code).toBe(false);
    expect(visible.every((line) => line.text.length <= 24)).toBe(true);
  });

  test("keeps inline markdown balanced when a transcript line is truncated", () => {
    expect(
      transcriptWindow("**A deliberately long bold result for the terminal**", 2, 24)[0]?.text
    ).toBe("**A deliberately long…**");
    expect(transcriptWindow("`a-very-long-inline-code-value`", 2, 18)[0]?.text).toBe(
      "`a-very-long-inl…`"
    );
  });

  test("selects native clipboard helpers without invoking a shell", () => {
    expect(clipboardCandidates("darwin", {})).toEqual([["pbcopy"]]);
    expect(clipboardCandidates("win32", {})).toEqual([["clip.exe"], ["clip"]]);
    expect(clipboardCandidates("linux", { WAYLAND_DISPLAY: "wayland-0" })[0]).toEqual(["wl-copy"]);
    expect(clipboardCandidates("linux", {}).at(-1)).toEqual(["xsel", "--clipboard", "--input"]);
  });

  test("uses one reversible alternate screen for interactive terminals", () => {
    expect(terminalScreenSequence(true, {})).toEqual({
      enter: "\u001B[?1049h\u001B[2J\u001B[H\u001B[?25l",
      exit: "\u001B[?25h\u001B[?1049l",
    });
    expect(terminalScreenSequence(false, {})).toBeNull();
    expect(terminalScreenSequence(true, { TERM: "dumb" })).toBeNull();
    expect(terminalScreenSequence(true, { CYBARA_TUI_ALT_SCREEN: "0" })).toBeNull();
  });
});
