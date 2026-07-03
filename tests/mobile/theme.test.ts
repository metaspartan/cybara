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

  test("colors is a live binding the scheme swaps at runtime", () => {
    expect(theme).toContain("export let colors");
    expect(theme).toContain("export function setActiveScheme");
    expect(theme).toContain("export function subscribeColors");
    const ctx = read("theme/ThemeContext.tsx");
    expect(ctx).toContain("setActiveScheme(scheme)");
  });

  test("dark palette follows Apple elevation (near-black base, gray card ladder, white label)", () => {
    const dark = theme.slice(theme.indexOf("darkColors"), theme.indexOf("lightColors"));
    expect(dark).toMatch(/background:\s*"#000000"/);
    expect(dark).toMatch(/text:\s*"#ffffff"/);
    expect(dark).toContain('surface: "#1c1c1e"');
    expect(dark).toContain('surfaceLift: "#2c2c2e"');
  });

  test("both palettes expose a translucent chrome token for floating glass", () => {
    const dark = theme.slice(theme.indexOf("darkColors"), theme.indexOf("lightColors"));
    const light = theme.slice(theme.indexOf("lightColors"));
    expect(dark).toMatch(/chrome:\s*"rgba\([^)]*0\.5\)"/);
    expect(light).toContain("chrome:");
  });

  test("LiquidGlass prefers native expo-glass-effect and falls back to BlurView", () => {
    const src = read("components/LiquidGlass.tsx");
    expect(src).toContain('import("expo-glass-effect")');
    expect(src).toContain("isLiquidGlassAvailable");
    expect(src).toContain("GlassView");
    expect(src).toContain('from "expo-blur"');
    expect(src).toContain("BlurView");
  });

  test("tab bar and chat composer use the LiquidGlass surface (no opaque fill)", () => {
    const screen = read("screens/DashboardScreen.tsx");
    expect(screen).toContain("import { LiquidGlass }");
    expect(screen).toContain("<LiquidGlass");
    // the composer bar must be full-bleed glass, not an opaque surface bar
    const barStyle = screen.slice(screen.indexOf("chatComposerBar: {"));
    expect(barStyle.slice(0, 200)).not.toContain("backgroundColor");
  });

  test("every styled surface rebuilds its StyleSheet when the scheme changes", () => {
    const styledFiles = [
      // Dashboard styles were extracted from the screen into their own module.
      "screens/dashboardStyles.ts",
      "screens/ConnectScreen.tsx",
      "components/Glass.tsx",
      "components/NewChatPanel.tsx",
      "components/MetricVisuals.tsx",
    ];
    for (const rel of styledFiles) {
      const src = read(rel);
      expect(src).toMatch(/const makeStyles = \(\) =>\s*StyleSheet\.create\(/);
      expect(src).toContain("subscribeColors(() => {");
      // no un-rebuilt static stylesheet left behind
      expect(src).not.toContain("const styles = StyleSheet.create(");
    }
  });
});
