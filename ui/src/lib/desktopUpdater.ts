import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriDesktopRuntime } from "./desktopHost";

export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "done"
  | "error";

export interface DesktopUpdateSnapshot {
  phase: DesktopUpdatePhase;
  version: string | null;
  currentVersion: string | null;
  body: string | null;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  lastCheckedAtMs: number | null;
  error: string | null;
}

export function describeDesktopUpdaterError(error: unknown): string {
  const message =
    error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";

  if (!message) return "Desktop update failed.";

  if (
    /plugin.*not initialized|unknown plugin|permission|not configured|missing.*updater|endpoint/i.test(
      message
    )
  ) {
    return "Updater is unavailable in this build. Install an official release or rebuild with updater signing configured.";
  }

  return message;
}

export async function getDesktopUpdateState(): Promise<DesktopUpdateSnapshot | null> {
  if (!isTauriDesktopRuntime()) return null;
  return invoke<DesktopUpdateSnapshot>("get_desktop_update_state");
}

export async function checkForDesktopUpdate(): Promise<DesktopUpdateSnapshot | null> {
  if (!isTauriDesktopRuntime()) return null;
  return invoke<DesktopUpdateSnapshot>("check_desktop_update");
}

export async function installDesktopUpdate(): Promise<DesktopUpdateSnapshot | null> {
  if (!isTauriDesktopRuntime()) return null;
  return invoke<DesktopUpdateSnapshot>("install_desktop_update");
}

export async function listenForDesktopUpdateState(
  listener: (snapshot: DesktopUpdateSnapshot) => void
): Promise<UnlistenFn> {
  return listen<DesktopUpdateSnapshot>("cybara://update-state", (event) => {
    listener(event.payload);
  });
}
