import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

export function isTauriDesktopRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

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
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

export async function installDesktopUpdate(
  update: Update,
  onEvent?: (event: DownloadEvent) => void
): Promise<void> {
  await update.downloadAndInstall(onEvent);
}

export async function relaunchDesktopApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
