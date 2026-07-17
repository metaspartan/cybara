export type TuiColorScheme = "dark" | "light";

export interface TuiSurfacePalette {
  accent: string;
  activity: string;
  background: string;
  border: string;
  canvas: string;
  chrome: string;
  code: string;
  danger: string;
  detail: string;
  heading: string;
  muted: string;
  section: string;
  shortcut: string;
  subtle: string;
  success: string;
  text: string;
  user: string;
  warning: string;
}

function colorBackground(value: string | undefined): number | null {
  const segment = value?.split(";").at(-1)?.trim();
  if (!segment || !/^\d+$/.test(segment)) return null;
  return Number.parseInt(segment, 10);
}

export function resolveTuiColorScheme(env: NodeJS.ProcessEnv): TuiColorScheme {
  const requested = env.CYBARA_TUI_THEME?.trim().toLowerCase();
  if (requested === "light" || requested === "dark") return requested;
  const background = colorBackground(env.COLORFGBG);
  return background === 7 || background === 15 ? "light" : "dark";
}

export function tuiChatPalette(scheme: TuiColorScheme): TuiSurfacePalette {
  if (scheme === "light") {
    return {
      accent: "#176b87",
      activity: "#4b5d6e",
      background: "#edf2f6",
      border: "#a8b3be",
      canvas: "#f7f9fb",
      chrome: "#edf2f6",
      code: "#7e4ca5",
      danger: "#b42318",
      detail: "#5d6d7c",
      heading: "#111827",
      muted: "#647180",
      section: "#34495e",
      shortcut: "#6b7178",
      subtle: "#7b8794",
      success: "#18794e",
      text: "#354351",
      user: "#0b6875",
      warning: "#9a6700",
    };
  }
  return {
    accent: "#67d2dc",
    activity: "#aeb9c6",
    background: "#121922",
    border: "#3c4a59",
    canvas: "#0a0f15",
    chrome: "#121922",
    code: "#d5a6f6",
    danger: "#f08080",
    detail: "#98a7b8",
    heading: "#f3f6fa",
    muted: "#8290a1",
    section: "#c2ccd8",
    shortcut: "#737981",
    subtle: "#687586",
    success: "#58d68d",
    text: "#c6d0dc",
    user: "#76cfe0",
    warning: "#e8bf6a",
  };
}
