import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { isTauriDesktopRuntime } from "./desktopHost";

export function describeDesktopUpdaterError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message.trim()
      : typeof error === "string"
        ? error.trim()
        : "";

  if (!message) {
    return "Desktop update failed.";
  }

  if (
    /plugin.*not initialized|unknown plugin|permission|not configured|missing.*updater|endpoint/i.test(
      message
    )
  ) {
    return "Updater is unavailable in this build. Install an official release or rebuild with updater signing configured.";
  }

  return message;
}

export async function checkForDesktopUpdate(): Promise<Update | null> {
  if (!isTauriDesktopRuntime()) {
    return null;
  }
  return check();
}

export async function installDesktopUpdate(
  update: Update,
  onEvent?: (event: DownloadEvent) => void
): Promise<void> {
  await update.downloadAndInstall(onEvent);
}

export async function relaunchDesktopApp(): Promise<void> {
  await relaunch();
}
