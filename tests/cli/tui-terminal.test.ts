import { describe, expect, test } from "bun:test";
import {
  chatEscapeAction,
  clipboardCandidates,
  composerWindow,
  nextTranscriptOffset,
  parseTerminalMouseEvent,
  resolveTerminalChatInspector,
  resolveTerminalLayout,
  terminalSelectionWindow,
  terminalScreenSequence,
  terminalMouseTrackingSequence,
  transcriptOffsetAfterMessageChange,
  transcriptMessageLimit,
  transcriptWindow,
} from "../../src/cli/tui/terminal";

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

  test("reserves a bounded right inspector only for wide chat terminals", () => {
    expect(resolveTerminalChatInspector(100)).toEqual({
      contentColumns: 100,
      sidebar: false,
      width: 0,
    });
    expect(resolveTerminalChatInspector(120)).toEqual({
      contentColumns: 85,
      sidebar: true,
      width: 34,
    });
    expect(resolveTerminalChatInspector(220)).toEqual({
      contentColumns: 175,
      sidebar: true,
      width: 44,
    });
  });

  test("keeps long selection lists inside the available terminal rows", () => {
    expect(terminalSelectionWindow(76, 0, 12)).toEqual({ count: 12, start: 0 });
    expect(terminalSelectionWindow(76, 38, 12)).toEqual({ count: 12, start: 32 });
    expect(terminalSelectionWindow(76, 75, 12)).toEqual({ count: 12, start: 64 });
    expect(terminalSelectionWindow(0, 0, 12)).toEqual({ count: 0, start: 0 });
    expect(terminalSelectionWindow(3, 7, 0)).toEqual({ count: 1, start: 2 });
  });

  test("keeps the cursor line visible in bounded multiline prompts", () => {
    const input = ["one", "two", "three", "four", "five", "six"].join("\n");
    const cursor = input.indexOf("four") + 2;
    const visible = composerWindow(input, cursor, 3);
    expect(visible).toHaveLength(3);
    expect(visible.join("\n")).toContain("▏");
    expect(visible.join("\n").replace("▏", "")).toContain("four");
  });

  test("dismisses chat overlays and drafts before leaving the session", () => {
    expect(chatEscapeAction(true, true)).toBe("close_panel");
    expect(chatEscapeAction(false, true)).toBe("clear_draft");
    expect(chatEscapeAction(false, false, true)).toBe("keep_run");
    expect(chatEscapeAction(false, false)).toBe("back");
  });

  test("bounds transcript rows without shortening their content", () => {
    const content = [
      "Intro",
      "```ts",
      "const longValue = 'abcdefghijklmnopqrstuvwxyz';",
      "```",
      "**Result:** complete",
      "Final",
    ].join("\n");
    const visible = transcriptWindow(content, 4);
    expect(visible).toHaveLength(4);
    expect(visible.some((line) => line.hidden)).toBe(true);
    expect(visible.at(-1)?.text).toBe("Final");
    expect(visible.at(-1)?.code).toBe(false);
    expect(visible[1]?.text).toBe("```ts");
  });

  test("preserves long prose and inline markdown for terminal wrapping", () => {
    const prose =
      "A deliberately long response remains complete even when the terminal is much narrower.";
    expect(transcriptWindow(prose, 2)[0]?.text).toBe(prose);
    expect(
      transcriptWindow("**A deliberately long bold result for the terminal**", 2)[0]?.text
    ).toBe("**A deliberately long bold result for the terminal**");
    expect(transcriptWindow("`a-very-long-inline-code-value`", 2)[0]?.text).toBe(
      "`a-very-long-inline-code-value`"
    );
  });

  test("budgets compact transcript content by rendered terminal rows", () => {
    const content = [
      "A long first line that wraps across several rows in a narrow terminal viewport.",
      "Middle content",
      "A complete final line that remains available after compacting.",
    ].join("\n");
    const visible = transcriptWindow(content, 5, 24);
    expect(visible.some((line) => line.hidden)).toBe(true);
    expect(visible[0]?.text.endsWith("…")).toBe(true);
    expect(visible.at(-1)?.text.startsWith("…")).toBe(true);
    expect(
      visible.reduce((total, line) => total + Math.ceil(line.text.length / 24), 0)
    ).toBeLessThanOrEqual(7);
    expect(visible.at(-1)?.text).toContain("line that remains available");
  });

  test("shows one complete message in expanded transcript mode", () => {
    expect(transcriptMessageLimit(5, true)).toBe(1);
    expect(transcriptMessageLimit(5, false)).toBe(5);
    expect(transcriptMessageLimit(0, false)).toBe(1);
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

  test("captures portable SGR mouse scrolling with an explicit opt-out", () => {
    expect(terminalMouseTrackingSequence(true, {}, true)).toEqual({
      enter: "\u001B[?1000h\u001B[?1006h",
      exit: "\u001B[?1006l\u001B[?1000l",
    });
    expect(terminalMouseTrackingSequence(false, {}, true)).toBeNull();
    expect(terminalMouseTrackingSequence(true, { TERM: "dumb" }, true)).toBeNull();
    expect(terminalMouseTrackingSequence(true, { CYBARA_TUI_MOUSE: "0" }, true)).toBeNull();
    expect(parseTerminalMouseEvent("[<64;12;8M")).toEqual({
      type: "scroll",
      direction: "up",
    });
    expect(parseTerminalMouseEvent("\u001B[<65;12;8M")).toEqual({
      type: "scroll",
      direction: "down",
    });
    expect(parseTerminalMouseEvent("[<0;12;8M")).toEqual({ type: "button" });
    expect(parseTerminalMouseEvent("hello")).toBeNull();
  });

  test("bounds line and page transcript movement and preserves a scrolled viewport", () => {
    expect(nextTranscriptOffset(0, 12, 1)).toBe(1);
    expect(nextTranscriptOffset(11, 12, 5)).toBe(12);
    expect(nextTranscriptOffset(2, 12, -5)).toBe(0);
    expect(transcriptOffsetAfterMessageChange(4, 20, 23)).toBe(7);
    expect(transcriptOffsetAfterMessageChange(0, 20, 23)).toBe(0);
    expect(transcriptOffsetAfterMessageChange(2, 20, 10)).toBe(0);
  });
});
