import {
  CUSTOM_THEME_FILE_MAX_BYTES,
  type CustomThemeBundle,
  normalizeCustomThemeBundle,
  serializeCustomThemeBundle,
} from "../../../../../shared/custom-themes";

export async function readCustomThemeFile(file: File): Promise<CustomThemeBundle> {
  if (file.size > CUSTOM_THEME_FILE_MAX_BYTES) {
    throw new Error("Theme file is larger than 64 KB");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Theme file is not valid JSON");
  }
  const theme = normalizeCustomThemeBundle(parsed);
  if (!theme) throw new Error("Theme file does not match the Cybara theme format");
  return theme;
}

export function downloadCustomTheme(theme: CustomThemeBundle): void {
  const blob = new Blob([serializeCustomThemeBundle(theme)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${theme.id}.cybara-theme.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function copyCustomTheme(theme: CustomThemeBundle): Promise<void> {
  await navigator.clipboard.writeText(serializeCustomThemeBundle(theme));
}
