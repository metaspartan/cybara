import { Platform, StyleSheet } from "react-native";

export const colors = {
  background: "#020407",
  backgroundLift: "#070b10",
  text: "#f3f8fb",
  textMuted: "#94a3ad",
  textDim: "#5f6c75",
  cyan: "#55d8ff",
  blueText: "#8fcaff",
  green: "#6ff5b0",
  amber: "#f6c96b",
  red: "#ff7b8b",
  border: "rgba(174, 195, 208, 0.14)",
  borderStrong: "rgba(190, 213, 226, 0.24)",
  glass: "rgba(8, 13, 19, 0.82)",
  glassElevated: "rgba(13, 20, 27, 0.88)",
  glassPressed: "rgba(28, 41, 51, 0.88)",
};

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
