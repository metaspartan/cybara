export type TuiColorScheme = "dark" | "light";

export interface TuiSurfacePalette {
  accent: string;
  activity: string;
  background: string;
  border: string;
  detail: string;
  muted: string;
  subtle: string;
  text: string;
  user: string;
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
      accent: "#1467b8",
      activity: "#4d5b68",
      background: "#edf1f4",
      border: "#9aa5b1",
      detail: "#32414e",
      muted: "#596674",
      subtle: "#78838e",
      text: "#18212b",
      user: "#0f6f82",
    };
  }
  return {
    accent: "#72d7e1",
    activity: "#abb6c4",
    background: "#141b23",
    border: "#485666",
    detail: "#c8d0da",
    muted: "#8d99a8",
    subtle: "#6f7b89",
    text: "#edf2f7",
    user: "#76dce5",
  };
}
