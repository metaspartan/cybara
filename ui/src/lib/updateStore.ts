import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isTauriDesktopRuntime } from "./desktopHost";
import {
  checkForDesktopUpdate,
  type DesktopUpdatePhase,
  type DesktopUpdateSnapshot,
  describeDesktopUpdaterError,
  getDesktopUpdateState,
  installDesktopUpdate,
  listenForDesktopUpdateState,
} from "./desktopUpdater";

export type UpdatePhase = DesktopUpdatePhase;

export interface DesktopUpdateInfo {
  version: string;
  currentVersion: string | null;
  body: string | null;
}

export interface UpdateState {
  phase: UpdatePhase;
  available: DesktopUpdateInfo | null;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  lastCheckedAt: string | null;
  error: string | null;
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
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

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function applyDesktopSnapshot(snapshot: DesktopUpdateSnapshot): void {
  setState({
    phase: snapshot.phase,
    available: snapshot.version
      ? {
          version: snapshot.version,
          currentVersion: snapshot.currentVersion,
          body: snapshot.body,
        }
      : null,
    progress: snapshot.progress,
    downloadedBytes: snapshot.downloadedBytes,
    totalBytes: snapshot.totalBytes,
    lastCheckedAt:
      snapshot.lastCheckedAtMs === null
        ? state.lastCheckedAt
        : new Date(snapshot.lastCheckedAtMs).toISOString(),
    error: snapshot.error,
  });
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeUpdateState(listener: () => void): () => void {
  listeners.add(listener);
  ensureUpdatePolling();
  return () => listeners.delete(listener);
}

async function notifyOs(version: string): Promise<void> {
  try {
    if (localStorage.getItem(NOTIFIED_VERSION_KEY) === version) return;
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;

    const title = "Cybara update available";
    const body = `Version ${version} is ready. Click to install and restart Cybara.`;
    if (typeof Notification === "undefined") {
      sendNotification({ title, body });
    } else {
      const notification = new Notification(title, { body });
      notification.onclick = () => {
        void startUpdateInstall();
      };
    }
    localStorage.setItem(NOTIFIED_VERSION_KEY, version);
  } catch {
    return;
  }
}

export async function checkForUpdate(): Promise<void> {
  if (!isTauriDesktopRuntime()) return;
  if (state.phase === "downloading" || state.phase === "installing" || state.phase === "done") {
    return;
  }
  setState({ phase: "checking", error: null });
  try {
    const snapshot = await checkForDesktopUpdate();
    if (!snapshot) return;
    applyDesktopSnapshot(snapshot);
    if (snapshot.phase === "available" && snapshot.version) void notifyOs(snapshot.version);
  } catch (error) {
    setState({
      phase: state.available ? "available" : "error",
      error: describeDesktopUpdaterError(error),
      lastCheckedAt: new Date().toISOString(),
    });
  }
}

export async function startUpdateInstall(): Promise<void> {
  if (!isTauriDesktopRuntime()) return;
  if (state.phase === "downloading" || state.phase === "installing" || state.phase === "done") {
    return;
  }
  setState({
    phase: "downloading",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
  });
  try {
    const snapshot = await installDesktopUpdate();
    if (snapshot) applyDesktopSnapshot(snapshot);
  } catch (error) {
    setState({
      phase: state.available ? "available" : "error",
      error: describeDesktopUpdaterError(error),
    });
  }
}

async function initializeUpdateState(): Promise<void> {
  try {
    await listenForDesktopUpdateState((snapshot) => {
      applyDesktopSnapshot(snapshot);
      if (snapshot.phase === "available" && snapshot.version && !snapshot.error) {
        void notifyOs(snapshot.version);
      }
    });
    const snapshot = await getDesktopUpdateState();
    if (snapshot) applyDesktopSnapshot(snapshot);
    if (!snapshot || snapshot.phase === "idle" || snapshot.phase === "error") {
      await checkForUpdate();
    }
  } catch (error) {
    setState({ phase: "error", error: describeDesktopUpdaterError(error) });
  }
}

export function ensureUpdatePolling(): void {
  if (started || !isTauriDesktopRuntime()) return;
  started = true;
  void initializeUpdateState();
  window.setInterval(() => {
    if (!document.hidden) void checkForUpdate();
  }, CHECK_INTERVAL_MS);
  window.addEventListener("focus", () => void checkForUpdate());
}
