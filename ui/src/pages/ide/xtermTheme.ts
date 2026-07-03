import type { ITheme } from "@xterm/xterm";

/**
 * The shared Cybara xterm color palette. Both the standalone Terminal page and
 * the IDE's embedded terminal used a byte-for-byte identical palette apart from
 * the surface background, so it lived duplicated in two files. `background`
 * (and the matching `cursorAccent`) is the only knob callers need.
 */
export function buildXtermTheme(background = "#0a0a0f"): ITheme {
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
