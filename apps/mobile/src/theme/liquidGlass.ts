import { Platform, StyleSheet } from "react-native";

// Dark palette follows Apple's Dark Mode system: a base -> elevated gray ladder
// (systemBackground #000 -> secondary #1c1c1e -> tertiary #2c2c2e), pure-white
// primary label, systemGray secondary/tertiary labels, and translucent glass
// tints so blurred chrome (nav bar, composer) shows content behind it.
export const darkColors = {
  background: "#000000",
  backgroundLift: "#1c1c1e",
  text: "#ffffff",
  textMuted: "#98989f",
  textDim: "#68686e",
  cyan: "#55d8ff",
  blueText: "#8fcaff",
  green: "#6ff5b0",
  amber: "#f6c96b",
  red: "#ff7b8b",
  border: "rgba(255, 255, 255, 0.14)",
  borderStrong: "rgba(255, 255, 255, 0.22)",
  glass: "rgba(44, 44, 46, 0.6)",
  glassElevated: "rgba(58, 58, 60, 0.64)",
  glassPressed: "rgba(72, 72, 74, 0.82)",
  surface: "#1c1c1e",
  surfaceLift: "#2c2c2e",
  inset: "rgba(255, 255, 255, 0.06)",
  insetStrong: "rgba(255, 255, 255, 0.1)",
  scrim: "rgba(0, 0, 0, 0.5)",
  wash: "rgba(255, 255, 255, 0.03)",
  chrome: "rgba(30, 30, 32, 0.5)",
  softCyan: "rgba(85, 216, 255, 0.14)",
  softCyanBorder: "rgba(85, 216, 255, 0.5)",
  softRed: "rgba(255, 123, 139, 0.14)",
  softRedBorder: "rgba(255, 123, 139, 0.4)",
};

// Light palette mirrors Apple's grouped-list light system: grouped background
// #f2f2f7 with white cards, near-black label, systemGray secondary labels.
export const lightColors: typeof darkColors = {
  background: "#f2f2f7",
  backgroundLift: "#ffffff",
  text: "#1c1c1e",
  textMuted: "#55555c",
  textDim: "#6e6e73",
  cyan: "#0a91b1",
  blueText: "#2563eb",
  green: "#0f9d63",
  amber: "#b45309",
  red: "#dc2626",
  border: "rgba(60, 60, 67, 0.16)",
  borderStrong: "rgba(60, 60, 67, 0.29)",
  glass: "rgba(255, 255, 255, 0.7)",
  glassElevated: "rgba(255, 255, 255, 0.8)",
  glassPressed: "rgba(60, 60, 67, 0.08)",
  surface: "#ffffff",
  surfaceLift: "#ffffff",
  inset: "rgba(60, 60, 67, 0.06)",
  insetStrong: "rgba(60, 60, 67, 0.1)",
  scrim: "rgba(0, 0, 0, 0.28)",
  wash: "rgba(255, 255, 255, 0.35)",
  chrome: "rgba(255, 255, 255, 0.6)",
  softCyan: "rgba(10, 145, 177, 0.1)",
  softCyanBorder: "rgba(10, 145, 177, 0.42)",
  softRed: "rgba(220, 38, 38, 0.1)",
  softRedBorder: "rgba(220, 38, 38, 0.34)",
};

export type Palette = typeof darkColors;
export type ColorScheme = "light" | "dark";

export const palettes: Record<ColorScheme, Palette> = {
  dark: darkColors,
  light: lightColors,
};

// `colors` is a live binding that swaps between the light/dark palette when the
// active scheme changes. StyleSheets built from it are rebuilt via
// subscribeColors(); inline `colors.x` reads (evaluated at render) update on the
// next render. This lets the whole app follow the system theme without threading
// a palette through every component.
export let colors: Palette = darkColors;

const colorListeners = new Set<() => void>();

export function setActiveScheme(scheme: ColorScheme): void {
  const next = palettes[scheme];
  if (next === colors) return;
  colors = next;
  for (const listener of colorListeners) listener();
}

export function subscribeColors(listener: () => void): () => void {
  colorListeners.add(listener);
  return () => {
    colorListeners.delete(listener);
  };
}

export const accentPalette = {
  indigo: "#6366f1",
  blue: "#3b82f6",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  emerald: "#10b981",
  amber: "#f59e0b",
  orange: "#f97316",
  rose: "#f43f5e",
  pink: "#ec4899",
  purple: "#a855f7",
} as const;

export type AccentKey = keyof typeof accentPalette;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
};

export const shadows = StyleSheet.create({
  glass: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: Platform.OS === "ios" ? 0.34 : 0.22,
    shadowRadius: 32,
    elevation: 12,
  },
});

export const typography = {
  title: 28,
  heading: 20,
  body: 15,
  label: 12,
  tiny: 11,
};
