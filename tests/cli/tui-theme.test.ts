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
      accent: "#72d7e1",
      activity: "#abb6c4",
      background: "#141b23",
      border: "#485666",
      detail: "#c8d0da",
      muted: "#8d99a8",
      subtle: "#6f7b89",
      text: "#edf2f7",
      user: "#76dce5",
    });
    expect(tuiChatPalette("light")).toEqual({
      accent: "#1467b8",
      activity: "#4d5b68",
      background: "#edf1f4",
      border: "#9aa5b1",
      detail: "#32414e",
      muted: "#596674",
      subtle: "#78838e",
      text: "#18212b",
      user: "#0f6f82",
    });
  });
});
