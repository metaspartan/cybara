import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { isTauriDesktopRuntime } from "./desktopHost";
import {
  checkForDesktopUpdate,
  describeDesktopUpdaterError,
  installDesktopUpdate,
  relaunchDesktopApp,
} from "./desktopUpdater";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "done"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  available: Update | null;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  lastCheckedAt: string | null;
  error: string | null;
}

const CHECK_INTERVAL_MS = 60 * 1000;
const NOTIFIED_VERSION_KEY = "cybara-update-notified-version";

let state: UpdateState = {
  phase: "idle",
  available: null,
  progress: 0,
  downloadedBytes: 0,
  totalBytes: null,
  lastCheckedAt: null,
  error: null,
};

const listeners = new Set<() => void>();
let started = false;
let installing = false;

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeUpdateState(listener: () => void): () => void {
  listeners.add(listener);
  ensureUpdatePolling();
  return () => listeners.delete(listener);
}

async function notifyTray(
  available: boolean,
  version: string | null,
  status?: "checking" | "downloading" | "installing" | "done" | "error"
): Promise<void> {
  try {
    await invoke("set_update_available", { available, version, status: status ?? null });
  } catch (error) {
    console.warn("[updates] tray notify failed:", error);
  }
}

async function notifyOs(version: string): Promise<void> {
  try {
    if (localStorage.getItem(NOTIFIED_VERSION_KEY) === version) return;
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;
    sendNotification({
      title: "Cybara update available",
      body: `Version ${version} is ready to install. Click Update in the sidebar or system tray.`,
    });
    localStorage.setItem(NOTIFIED_VERSION_KEY, version);
  } catch {
    /* notifications unavailable */
  }
}

export async function checkForUpdate(): Promise<void> {
  if (!isTauriDesktopRuntime() || installing) return;
  if (state.phase === "idle" || state.phase === "current" || state.phase === "error") {
    setState({ phase: "checking", error: null });
  }
  void notifyTray(false, null, "checking");
  try {
    const update = await checkForDesktopUpdate();
    const lastCheckedAt = new Date().toISOString();
    if (update) {
      setState({ phase: "available", available: update, lastCheckedAt, error: null });
      void notifyTray(true, update.version);
      void notifyOs(update.version);
    } else {
      if (state.available) {
        setState({ phase: "available", lastCheckedAt, error: null });
        void notifyTray(true, state.available.version);
      } else {
        setState({ phase: "current", available: null, lastCheckedAt, error: null });
        void notifyTray(false, null);
      }
    }
  } catch (error) {
    const message = describeDesktopUpdaterError(error);
    setState({
      phase: state.available ? "available" : "error",
      lastCheckedAt: new Date().toISOString(),
      error: message,
    });
    if (state.available) {
      void notifyTray(true, state.available.version);
    } else {
      void notifyTray(false, null, "error");
    }
  }
}

export async function startUpdateInstall(): Promise<void> {
  const update = state.available;
  if (!update || installing) return;
  installing = true;
  setState({ phase: "downloading", progress: 0, downloadedBytes: 0, totalBytes: null });
  await notifyTray(true, update.version, "downloading");
  let total = 0;
  let downloaded = 0;
  try {
    await installDesktopUpdate(update, (event: DownloadEvent) => {
      if (event.event === "Started") {
        total = event.data.contentLength || 0;
        setState({ totalBytes: total > 0 ? total : null });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        setState({
          downloadedBytes: downloaded,
          progress: total > 0 ? Math.min(1, downloaded / total) : 0,
        });
      } else if (event.event === "Finished") {
        setState({ phase: "installing", progress: 1 });
        void notifyTray(true, update.version, "installing");
      }
    });
    setState({ phase: "done", progress: 1 });
    void notifyTray(true, update.version, "done");
    await new Promise((resolve) => setTimeout(resolve, 900));
    await relaunchDesktopApp();
  } catch (error) {
    installing = false;
    setState({ phase: "available", error: describeDesktopUpdaterError(error) });
    void notifyTray(true, update.version);
  }
}

async function startTrayUpdateInstall(): Promise<void> {
  if (!state.available) await checkForUpdate();
  await startUpdateInstall();
}

export function ensureUpdatePolling(): void {
  if (started || !isTauriDesktopRuntime()) return;
  started = true;
  void checkForUpdate();
  window.setInterval(() => {
    if (!document.hidden) void checkForUpdate();
  }, CHECK_INTERVAL_MS);
  window.addEventListener("focus", () => void checkForUpdate());
  listen("cybara://install-update", () => {
    void startTrayUpdateInstall();
  }).catch(() => {
    /* event API unavailable */
  });
}
