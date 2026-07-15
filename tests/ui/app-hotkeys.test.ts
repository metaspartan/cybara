import { describe, expect, test } from "bun:test";
import {
  APP_HOTKEYS,
  appHotkeyActionForEvent,
  bindingFromKeyboardEvent,
  formatAppHotkey,
  resolveAppHotkeys,
} from "../../ui/src/lib/appHotkeys";

function keyboardEvent(
  key: string,
  options: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code">> = {}
): KeyboardEvent {
  return {
    altKey: false,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...options,
  } as KeyboardEvent;
}

describe("app hotkeys", () => {
  test("resolves defaults and targeted overrides", () => {
    const resolved = resolveAppHotkeys({ openChat: "mod+9" });
    expect(resolved.openChat).toBe("mod+9");
    expect(resolved.newChat).toBe("mod+shift+n");
    expect(Object.keys(resolved)).toHaveLength(APP_HOTKEYS.length);
  });

  test("normalizes cross-platform modifier input", () => {
    expect(bindingFromKeyboardEvent(keyboardEvent("n", { metaKey: true, shiftKey: true }))).toBe(
      "mod+shift+n"
    );
    expect(bindingFromKeyboardEvent(keyboardEvent("n", { ctrlKey: true, shiftKey: true }))).toBe(
      "mod+shift+n"
    );
    expect(bindingFromKeyboardEvent(keyboardEvent("Meta", { metaKey: true }))).toBe("");
    expect(bindingFromKeyboardEvent(keyboardEvent("Shift", { shiftKey: true }))).toBe("");
  });

  test("matches actions and formats native labels", () => {
    const resolved = resolveAppHotkeys({});
    expect(
      appHotkeyActionForEvent(keyboardEvent("1", { ctrlKey: true, code: "Digit1" }), resolved)
    ).toBe("openChat");
    expect(formatAppHotkey("mod+shift+n", true)).toBe("⌘⇧N");
    expect(formatAppHotkey("mod+shift+n", false)).toBe("Ctrl+Shift+N");
  });
});
