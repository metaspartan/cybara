import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");
const readApp = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../apps/mobile/${rel}`, import.meta.url)), "utf8");

describe("mobile appearance + background", () => {
  test("system appearance is enabled so light/dark follow the device", () => {
    const appJson = JSON.parse(readApp("app.json"));
    // Forcing "dark" made useColorScheme always report dark, so "System" and
    // light mode never worked. "automatic" lets the OS drive the scheme.
    expect(appJson.expo.userInterfaceStyle).toBe("automatic");
  });

  test("App shell paints a single base background (no duplicated layer)", () => {
    const app = readApp("App.tsx");
    const matches = app.match(/backgroundColor:\s*colors\.background/g) ?? [];
    // Previously both `safe` and `background` painted it; now just one base.
    expect(matches.length).toBe(1);
    expect(app).not.toContain("styles.background");
  });

  test("both palettes carry translucent glass tints (fully liquid glass)", () => {
    const theme = read("theme/liquidGlass.ts");
    const dark = theme.slice(theme.indexOf("darkColors"), theme.indexOf("lightColors"));
    const light = theme.slice(theme.indexOf("lightColors"));
    for (const palette of [dark, light]) {
      expect(palette).toMatch(/glass:\s*"rgba\(/);
      expect(palette).toMatch(/glassElevated:\s*"rgba\(/);
    }
  });
});

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
    expect(screen).toContain('label="Theme"');
    expect(screen).toContain('variant="segmented"');
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

  test("shared glass probe prefers native expo-glass-effect", () => {
    const src = read("components/glassSupport.ts");
    expect(src).toContain('import("expo-glass-effect")');
    expect(src).toContain("isLiquidGlassAvailable");
    expect(src).toContain("GlassView");
    expect(src).toContain("useNativeGlassView");
    // Also loads GlassContainer for Apple's recommended adjacent-glass grouping.
    expect(src).toContain("GlassContainer");
    expect(src).toContain("useNativeGlassContainer");
  });

  test("GlassPanel's native surface is shape-only so the real material shows (not a white fill)", () => {
    const src = read("components/Glass.tsx");
    // Native path uses the shape style (border + radius, no backgroundColor)...
    expect(src).toContain("styles.panelShape");
    expect(src).toMatch(/panelShape:\s*\{[^}]*borderRadius/);
    const shape = src.slice(src.indexOf("panelShape: {"), src.indexOf("panelShapeElevated"));
    expect(shape).not.toContain("backgroundColor");
    // ...while the BlurView fallback still tints with colors.glass for contrast.
    expect(src).toMatch(/panel:\s*\{[^}]*backgroundColor:\s*colors\.glass/);
  });

  test("GlassGroup wraps clusters in a native GlassContainer with a plain-View fallback", () => {
    const src = read("components/LiquidGlass.tsx");
    expect(src).toContain("export function GlassGroup");
    expect(src).toContain("useNativeGlassContainer");
    expect(src).toContain("spacing");
    // Falls back to a plain View when Liquid Glass isn't available.
    expect(src).toMatch(/return <View style=\{style\}>\{children\}<\/View>/);
  });

  test("LiquidGlass and GlassPanel both use the native glass surface with a BlurView fallback", () => {
    // Every primary surface uses genuine iOS 26 Liquid Glass, not just LiquidGlass:
    // GlassPanel (the app's most-used surface) now upgrades too.
    for (const rel of ["components/LiquidGlass.tsx", "components/Glass.tsx"]) {
      const src = read(rel);
      expect(src).toContain("useNativeGlassView");
      expect(src).toContain("GlassView");
      expect(src).toContain('from "expo-blur"');
      expect(src).toContain("BlurView");
      expect(src).not.toContain("dimezisBlurViewSdk31Plus");
    }
  });

  test("GlassButton exposes native button semantics for pairing and automation", () => {
    const src = read("components/Glass.tsx");
    expect(src).toContain('accessibilityRole="button"');
    expect(src).toContain("accessibilityLabel={detail ? `${label}, ${detail}` : label}");
    expect(src).toContain("accessibilityState={{ selected: selected === true }}");
  });

  test("mobile manual pairing does not prefill localhost for physical phones", () => {
    const src = read("screens/ConnectScreen.tsx");
    expect(src).toContain('const [baseUrl, setBaseUrl] = useState("");');
    expect(src).toContain('placeholder="http://192.168.1.20:4269"');
    expect(src).not.toContain('useState("http://127.0.0.1:4269")');
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
