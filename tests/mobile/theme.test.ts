import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile theming", () => {
  const theme = read("theme/liquidGlass.ts");

  test("defines light and dark palettes with a shared type (enforces token parity)", () => {
    expect(theme).toContain("export const darkColors");
    // The `: typeof darkColors` annotation makes tsc require identical keys.
    expect(theme).toMatch(/export const lightColors:\s*typeof darkColors/);
    expect(theme).toContain("export const palettes");
    expect(theme).toContain("export type Palette");
  });

  test("light background/text differ from dark", () => {
    const light = theme.slice(theme.indexOf("lightColors"));
    expect(light).not.toContain('background: "#020407"');
    expect(light).toMatch(/text:\s*"#1/); // dark near-black text in light mode
  });

  test("ThemeContext follows the OS appearance and persists the choice", () => {
    const ctx = read("theme/ThemeContext.tsx");
    expect(ctx).toContain("useColorScheme");
    expect(ctx).toContain('"cybara.appearance"');
    expect(ctx).toContain("AsyncStorage.setItem");
    for (const m of ["system", "light", "dark"]) {
      expect(ctx).toContain(`"${m}"`);
    }
  });

  test("settings expose a System/Light/Dark appearance control", () => {
    const screen = read("screens/DashboardScreen.tsx");
    expect(screen).toContain('title="Appearance"');
    expect(screen).toContain("setAppearanceMode");
    expect(screen).toContain('{ label: "System", value: "system" }');
  });
});
