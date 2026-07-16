import { describe, expect, test } from "bun:test";
import { resolveTuiColorScheme, tuiChatPalette } from "../../src/cli-tui-theme";

describe("CLI TUI terminal theme", () => {
  test("honors an explicit light or dark terminal preference", () => {
    expect(resolveTuiColorScheme({ CYBARA_TUI_THEME: "light" })).toBe("light");
    expect(resolveTuiColorScheme({ CYBARA_TUI_THEME: "dark" })).toBe("dark");
  });

  test("uses COLORFGBG to follow light terminal backgrounds", () => {
    expect(resolveTuiColorScheme({ COLORFGBG: "0;15" })).toBe("light");
    expect(resolveTuiColorScheme({ COLORFGBG: "15;0" })).toBe("dark");
    expect(resolveTuiColorScheme({})).toBe("dark");
  });

  test("keeps inspector surfaces readable in both schemes", () => {
    expect(tuiChatPalette("dark")).toEqual({
      accent: "#67d2dc",
      activity: "#aeb9c6",
      background: "#121922",
      border: "#3c4a59",
      chrome: "#121922",
      code: "#d5a6f6",
      danger: "#f08080",
      detail: "#98a7b8",
      heading: "#f3f6fa",
      muted: "#8290a1",
      section: "#c2ccd8",
      shortcut: "#737981",
      subtle: "#687586",
      success: "#58d68d",
      text: "#c6d0dc",
      user: "#76cfe0",
      warning: "#e8bf6a",
    });
    expect(tuiChatPalette("light")).toEqual({
      accent: "#176b87",
      activity: "#4b5d6e",
      background: "#edf2f6",
      border: "#a8b3be",
      chrome: "#edf2f6",
      code: "#7e4ca5",
      danger: "#b42318",
      detail: "#5d6d7c",
      heading: "#111827",
      muted: "#647180",
      section: "#34495e",
      shortcut: "#6b7178",
      subtle: "#7b8794",
      success: "#18794e",
      text: "#354351",
      user: "#0b6875",
      warning: "#9a6700",
    });
  });

  test("uses neutral shortcut text and sidebar-matched structural chrome", () => {
    const dark = tuiChatPalette("dark");
    const light = tuiChatPalette("light");
    expect(dark.chrome).toBe(dark.background);
    expect(light.chrome).toBe(light.background);
    expect(dark.shortcut).toBe("#737981");
    expect(light.shortcut).toBe("#6b7178");
  });
});
