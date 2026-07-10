import type { ITheme } from "@xterm/xterm";

export function isLightThemeActive(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("light");
}

const DARK_VARIANT_BACKGROUNDS: Record<string, string> = {
  "icy-dark": "#060b13",
  "ash-grey": "#121316",
  "sand-dune": "#131009",
};

export function buildXtermTheme(background = "#0a0a0f"): ITheme {
  if (isLightThemeActive()) return buildXtermLightTheme();
  const mode =
    typeof document !== "undefined" ? document.documentElement.dataset.themeMode || "" : "";
  return buildXtermDarkTheme(DARK_VARIANT_BACKGROUNDS[mode] ?? background);
}

export function buildXtermDarkTheme(background = "#0a0a0f"): ITheme {
  return {
    background,
    foreground: "#e4e4e7",
    cursor: "#818cf8",
    cursorAccent: background,
    selectionBackground: "rgba(99, 102, 241, 0.3)",
    black: "#18181b",
    red: "#ef4444",
    green: "#22c55e",
    yellow: "#eab308",
    blue: "#3b82f6",
    magenta: "#a855f7",
    cyan: "#06b6d4",
    white: "#e4e4e7",
    brightBlack: "#52525b",
    brightRed: "#f87171",
    brightGreen: "#4ade80",
    brightYellow: "#facc15",
    brightBlue: "#60a5fa",
    brightMagenta: "#c084fc",
    brightCyan: "#22d3ee",
    brightWhite: "#fafafa",
  };
}

export function buildXtermLightTheme(background = "#ffffff"): ITheme {
  return {
    background,
    foreground: "#1f2937",
    cursor: "#4f46e5",
    cursorAccent: background,
    selectionBackground: "rgba(79, 70, 229, 0.22)",
    black: "#1f2937",
    red: "#dc2626",
    green: "#15803d",
    yellow: "#a16207",
    blue: "#1d4ed8",
    magenta: "#9333ea",
    cyan: "#0e7490",
    white: "#d1d5db",
    brightBlack: "#6b7280",
    brightRed: "#ef4444",
    brightGreen: "#16a34a",
    brightYellow: "#ca8a04",
    brightBlue: "#2563eb",
    brightMagenta: "#a855f7",
    brightCyan: "#0891b2",
    brightWhite: "#f9fafb",
  };
}
