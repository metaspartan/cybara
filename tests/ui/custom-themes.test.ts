import { describe, expect, test } from "bun:test";
import {
  createCustomThemeBundle,
  CUSTOM_THEME_FILE_MAX_BYTES,
  customThemeId,
  MAX_CUSTOM_THEMES,
  normalizeCustomThemeBundle,
  normalizeCustomThemeCollection,
  serializeCustomThemeBundle,
  themeContrastRatio,
} from "../../shared/custom-themes";
import { readCustomThemeFile } from "../../ui/src/pages/settings/theme/themeFiles";

describe("custom themes", () => {
  test("creates a complete versioned light and dark bundle", () => {
    const theme = createCustomThemeBundle("Studio Night");
    expect(theme.id).toBe("studio-night");
    expect(theme.version).toBe(1);
    expect(theme.light.background).toBe("#f4f6f8");
    expect(theme.dark.background).toBe("#0b0d10");
    expect(normalizeCustomThemeBundle(JSON.parse(serializeCustomThemeBundle(theme)))).toEqual(
      theme
    );
  });

  test("rejects malformed palettes and unsafe font values", () => {
    const theme = createCustomThemeBundle("Safe");
    expect(
      normalizeCustomThemeBundle({ ...theme, dark: { ...theme.dark, accent: "red" } })
    ).toBeNull();
    expect(normalizeCustomThemeBundle({ ...theme, uiFont: "Inter; background: red" })?.uiFont).toBe(
      createCustomThemeBundle("Safe").uiFont
    );
  });

  test("deduplicates, bounds, and validates active imported themes", () => {
    const themes = Array.from({ length: MAX_CUSTOM_THEMES + 5 }, (_, index) =>
      createCustomThemeBundle(`Theme ${index}`, `theme-${index}`)
    );
    const collection = normalizeCustomThemeCollection({
      version: 1,
      activeThemeId: "theme-3",
      themes: [themes[0], themes[0], ...themes.slice(1)],
    });
    expect(collection.themes).toHaveLength(MAX_CUSTOM_THEMES);
    expect(collection.activeThemeId).toBe("theme-3");
    expect(
      normalizeCustomThemeCollection({ themes, activeThemeId: "missing" }).activeThemeId
    ).toBeNull();
  });

  test("normalizes names into bounded identifiers", () => {
    expect(customThemeId("  Catppuccin Mocha! ")).toBe("catppuccin-mocha");
    expect(customThemeId("***")).toBe("custom-theme");
  });

  test("computes readable contrast ratios", () => {
    expect(themeContrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 4);
    expect(themeContrastRatio("#777777", "#777777")).toBe(1);
    expect(themeContrastRatio("bad", "#000000")).toBe(0);
  });

  test("imports valid files and rejects malformed or oversized files", async () => {
    const theme = createCustomThemeBundle("Imported Studio");
    const imported = await readCustomThemeFile(
      new File([serializeCustomThemeBundle(theme)], "studio.cybara-theme.json")
    );
    expect(imported).toEqual(theme);
    await expect(
      readCustomThemeFile(new File(["not json"], "broken.cybara-theme.json"))
    ).rejects.toThrow("not valid JSON");
    await expect(
      readCustomThemeFile(
        new File(["x".repeat(CUSTOM_THEME_FILE_MAX_BYTES + 1)], "large.cybara-theme.json")
      )
    ).rejects.toThrow("larger than 64 KB");
  });
});
