export const themeDefaultAccents = {
  system: "indigo",
  dark: "indigo",
  midnight: "purple",
  "icy-dark": "cyan",
  "ash-grey": "blue",
  forest: "emerald",
  catppuccin: "catppuccin",
  matrix: "matrix",
  slate: "blue",
  "sand-dune": "amber",
  light: "blue",
  icy: "cyan",
  paper: "amber",
  mint: "emerald",
  lavender: "purple",
  cake: "pink",
} as const;

export type ThemeDefaultMode = keyof typeof themeDefaultAccents;
export type ThemeDefaultAccent = (typeof themeDefaultAccents)[ThemeDefaultMode];

export function defaultThemeAccentForMode(mode: string): ThemeDefaultAccent {
  return mode in themeDefaultAccents
    ? themeDefaultAccents[mode as ThemeDefaultMode]
    : themeDefaultAccents.dark;
}
