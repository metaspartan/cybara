import { Platform, StyleSheet } from "react-native";

export const colors = {
  background: "#03070b",
  backgroundLift: "#071018",
  text: "#f3f8fb",
  textMuted: "#9badb8",
  textDim: "#647783",
  cyan: "#55d8ff",
  blueText: "#8fcaff",
  green: "#6ff5b0",
  amber: "#f6c96b",
  red: "#ff7b8b",
  border: "rgba(190, 232, 255, 0.18)",
  borderStrong: "rgba(198, 244, 255, 0.34)",
  glass: "rgba(17, 35, 47, 0.64)",
  glassElevated: "rgba(27, 53, 68, 0.72)",
  glassPressed: "rgba(58, 104, 124, 0.74)",
};

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
