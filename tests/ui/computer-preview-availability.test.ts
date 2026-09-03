import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPUTER_FOCUS_UNAVAILABLE_ERROR } from "../../shared/computer-preview";
import {
  COMPUTER_PREVIEW_IDLE_DISMISS_MS,
  computerPreviewDismissDelayMs,
  isComputerFocusUnavailableError,
} from "../../ui/src/pages/chat/floatingPreviewActivityModel";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("floating computer preview availability", () => {
  test("dismiss timer only runs while available and the agent is idle", () => {
    expect(computerPreviewDismissDelayMs({ active: false, available: false })).toBeNull();
    expect(computerPreviewDismissDelayMs({ active: true, available: false })).toBeNull();
    expect(computerPreviewDismissDelayMs({ active: true, available: true })).toBeNull();
    expect(computerPreviewDismissDelayMs({ active: false, available: true })).toBe(
      COMPUTER_PREVIEW_IDLE_DISMISS_MS
    );
  });

  test("focus unavailable matches the shared backend message exactly", () => {
    expect(COMPUTER_FOCUS_UNAVAILABLE_ERROR).toBe(
      "No desktop app is available to focus for this chat"
    );
    expect(isComputerFocusUnavailableError(`  ${COMPUTER_FOCUS_UNAVAILABLE_ERROR} `)).toBe(true);
    expect(isComputerFocusUnavailableError("Desktop app focus is local-only")).toBe(false);
    expect(isComputerFocusUnavailableError("Could not focus the app")).toBe(false);
    expect(isComputerFocusUnavailableError("")).toBe(false);
  });

  test("backend focus error reuses the shared message", () => {
    const core = read("src/core/computer-use.ts");
    expect(core).toContain("throw new Error(COMPUTER_FOCUS_UNAVAILABLE_ERROR)");
    expect(core).not.toContain('throw new Error("No desktop app is available to focus');
  });

  test("hook auto-dismisses the idle preview instead of pinning it to the session", () => {
    const hook = read("ui/src/pages/chat/useFloatingPreviewActivity.ts");
    expect(hook).toContain("computerPreviewDismissDelayMs");
    expect(hook).toContain("dismissComputerPreview");
    expect(hook).not.toContain("computerSeenSessionId");
  });

  test("floating window closes itself when focus reports no desktop app", () => {
    const component = read("ui/src/pages/chat/FloatingComputerPreview.tsx");
    expect(component).toContain("isComputerFocusUnavailableError(message)");
    expect(component).toContain("onFocusUnavailable()");
    const chat = read("ui/src/pages/Chat.tsx");
    expect(chat).toContain("onFocusUnavailable={floatingPreviewActivity.dismissComputerPreview}");
  });
});
