export const CUSTOM_THEME_VERSION = 1 as const;
export const MAX_CUSTOM_THEMES = 24;
export const CUSTOM_THEME_FILE_MAX_BYTES = 64 * 1024;

export type CustomThemeScheme = "system" | "light" | "dark";

export interface CustomThemePalette {
  accent: string;
  background: string;
  foreground: string;
  panel: string;
  raised: string;
  hover: string;
  muted: string;
  subtle: string;
  border: string;
}

export interface CustomThemeBundle {
  version: typeof CUSTOM_THEME_VERSION;
  id: string;
  name: string;
  scheme: CustomThemeScheme;
  light: CustomThemePalette;
  dark: CustomThemePalette;
  uiFont: string;
  codeFont: string;
  translucentSidebar: boolean;
  contrast: number;
}

export interface CustomThemeCollection {
  version: typeof CUSTOM_THEME_VERSION;
  activeThemeId: string | null;
  themes: CustomThemeBundle[];
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FONT_PATTERN = /^[^{};\r\n]{1,160}$/;
const SCHEMES = new Set<CustomThemeScheme>(["system", "light", "dark"]);

const paletteKeys = [
  "accent",
  "background",
  "foreground",
  "panel",
  "raised",
  "hover",
  "muted",
  "subtle",
  "border",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null;
}

function normalizeFont(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return FONT_PATTERN.test(normalized) ? normalized : fallback;
}

function normalizePalette(value: unknown): CustomThemePalette | null {
  if (!isRecord(value)) return null;
  const palette: Partial<CustomThemePalette> = {};
  for (const key of paletteKeys) {
    const color = normalizeColor(value[key]);
    if (!color) return null;
    palette[key] = color;
  }
  return palette as CustomThemePalette;
}

export function customThemeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return THEME_ID_PATTERN.test(normalized) ? normalized : "custom-theme";
}

export function normalizeCustomThemeBundle(value: unknown): CustomThemeBundle | null {
  if (!isRecord(value) || value.version !== CUSTOM_THEME_VERSION) return null;
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 80) : "";
  const rawId = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
  const id = THEME_ID_PATTERN.test(rawId) ? rawId : customThemeId(name);
  const scheme = typeof value.scheme === "string" ? value.scheme : "system";
  const light = normalizePalette(value.light);
  const dark = normalizePalette(value.dark);
  if (!name || !SCHEMES.has(scheme as CustomThemeScheme) || !light || !dark) return null;
  return {
    version: CUSTOM_THEME_VERSION,
    id,
    name,
    scheme: scheme as CustomThemeScheme,
    light,
    dark,
    uiFont: normalizeFont(
      value.uiFont,
      "'Outfit', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    ),
    codeFont: normalizeFont(
      value.codeFont,
      "'Zed Mono', Menlo, Monaco, Consolas, 'Courier New', monospace"
    ),
    translucentSidebar: value.translucentSidebar !== false,
    contrast:
      typeof value.contrast === "number" && Number.isFinite(value.contrast)
        ? Math.min(100, Math.max(0, Math.round(value.contrast)))
        : 50,
  };
}

export function normalizeCustomThemeCollection(value: unknown): CustomThemeCollection {
  if (!isRecord(value)) {
    return { version: CUSTOM_THEME_VERSION, activeThemeId: null, themes: [] };
  }
  const themes = Array.isArray(value.themes)
    ? value.themes
        .map(normalizeCustomThemeBundle)
        .filter((theme): theme is CustomThemeBundle => theme !== null)
        .filter((theme, index, all) => all.findIndex((entry) => entry.id === theme.id) === index)
        .slice(0, MAX_CUSTOM_THEMES)
    : [];
  const requestedActiveId = typeof value.activeThemeId === "string" ? value.activeThemeId : null;
  return {
    version: CUSTOM_THEME_VERSION,
    activeThemeId: themes.some((theme) => theme.id === requestedActiveId)
      ? requestedActiveId
      : null,
    themes,
  };
}

export function createCustomThemeBundle(name: string, id = customThemeId(name)): CustomThemeBundle {
  return {
    version: CUSTOM_THEME_VERSION,
    id,
    name: name.trim().slice(0, 80) || "Custom theme",
    scheme: "system",
    light: {
      accent: "#339cff",
      background: "#f4f6f8",
      foreground: "#18202a",
      panel: "#ffffff",
      raised: "#e8edf2",
      hover: "#dce4eb",
      muted: "#657281",
      subtle: "#8a95a1",
      border: "#cbd4dc",
    },
    dark: {
      accent: "#339cff",
      background: "#0b0d10",
      foreground: "#edf2f7",
      panel: "#13171c",
      raised: "#1b222a",
      hover: "#26313c",
      muted: "#9aa7b5",
      subtle: "#687583",
      border: "#303a45",
    },
    uiFont: "'Outfit', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    codeFont: "'Zed Mono', Menlo, Monaco, Consolas, 'Courier New', monospace",
    translucentSidebar: true,
    contrast: 50,
  };
}

export function serializeCustomThemeBundle(theme: CustomThemeBundle): string {
  return `${JSON.stringify(theme, null, 2)}\n`;
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function themeContrastRatio(foreground: string, background: string): number {
  if (!HEX_COLOR_PATTERN.test(foreground) || !HEX_COLOR_PATTERN.test(background)) return 0;
  const luminance = (color: string): number => {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return (
      0.2126 * linearChannel(red) +
      0.7152 * linearChannel(green) +
      0.0722 * linearChannel(blue)
    );
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
