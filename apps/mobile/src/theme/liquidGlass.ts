import { Platform, StyleSheet } from "react-native";

export const darkColors = {
  background: "#020407",
  backgroundLift: "#060607",
  text: "#f3f8fb",
  textMuted: "#94a3ad",
  textDim: "#5f6c75",
  cyan: "#55d8ff",
  blueText: "#8fcaff",
  green: "#6ff5b0",
  amber: "#f6c96b",
  red: "#ff7b8b",
  border: "rgba(214, 219, 224, 0.12)",
  borderStrong: "rgba(235, 239, 244, 0.2)",
  glass: "rgba(5, 5, 6, 0.9)",
  glassElevated: "rgba(9, 9, 11, 0.94)",
  glassPressed: "rgba(20, 20, 22, 0.92)",
};

export const lightColors: typeof darkColors = {
  background: "#f2f4f7",
  backgroundLift: "#ffffff",
  text: "#131a22",
  textMuted: "#5a6570",
  textDim: "#8a94a0",
  cyan: "#0e8fb8",
  blueText: "#2563eb",
  green: "#0f9d63",
  amber: "#b45309",
  red: "#dc2626",
  border: "rgba(17, 24, 32, 0.10)",
  borderStrong: "rgba(17, 24, 32, 0.16)",
  glass: "rgba(255, 255, 255, 0.72)",
  glassElevated: "rgba(255, 255, 255, 0.86)",
  glassPressed: "rgba(17, 24, 32, 0.05)",
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
