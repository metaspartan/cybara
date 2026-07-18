import {
  CUSTOM_THEME_FILE_MAX_BYTES,
  type CustomThemeBundle,
  normalizeCustomThemeBundle,
  serializeCustomThemeBundle,
} from "../../../../../shared/custom-themes";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriDesktopRuntime } from "@/lib/desktopHost";

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

function themeFileName(theme: CustomThemeBundle): string {
  return `${theme.id}.cybara-theme.json`;
}

export async function downloadCustomTheme(theme: CustomThemeBundle): Promise<boolean> {
  const content = serializeCustomThemeBundle(theme);
  const fileName = themeFileName(theme);
  if (isTauriDesktopRuntime()) {
    const path = await save({
      defaultPath: fileName,
      title: "Export theme",
      filters: [{ name: "Cybara theme", extensions: ["json"] }],
    });
    if (!path) return false;
    await invoke("write_theme_file", { path, content });
    return true;
  }

  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export async function copyCustomTheme(theme: CustomThemeBundle): Promise<void> {
  await navigator.clipboard.writeText(serializeCustomThemeBundle(theme));
}
