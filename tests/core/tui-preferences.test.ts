import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TUI_PREFERENCES,
  normalizeTuiPreferences,
  normalizeTuiScrollStep,
} from "../../shared/tui-preferences";

describe("terminal interface preferences", () => {
  test("uses readable defaults for missing and malformed settings", () => {
    expect(normalizeTuiPreferences(undefined)).toEqual(DEFAULT_TUI_PREFERENCES);
    expect(normalizeTuiPreferences({ mouseScrolling: "yes", scrollStep: "fast" })).toEqual(
      DEFAULT_TUI_PREFERENCES
    );
  });

  test("normalizes persisted mouse and wheel behavior", () => {
    expect(normalizeTuiPreferences({ mouseScrolling: false, scrollStep: 5 })).toEqual({
      mouseScrolling: false,
      scrollStep: 5,
    });
    expect(normalizeTuiScrollStep(0)).toBe(1);
    expect(normalizeTuiScrollStep(20)).toBe(8);
    expect(normalizeTuiScrollStep(3.6)).toBe(4);
  });
});
