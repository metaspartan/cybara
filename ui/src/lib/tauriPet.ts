import { persistPetPosition, readPetPosition } from "@/lib/petPreferences";

export const PET_WINDOW_LABEL = "pet";
export const PET_OPEN_SESSION_EVENT = "cybara://pet-open-session";
export const PET_WINDOW_SIZE = 84;
export const PET_WINDOW_EXPANDED = { width: 280, height: 380 };
export const PET_WINDOW_URL = "http://127.0.0.1:4269/?pet=1";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isPetWindow(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("pet");
}

export async function ensurePetWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(PET_WINDOW_LABEL);
  if (existing) {
    await existing.show();
    try {
      await existing.setVisibleOnAllWorkspaces(true);
      await existing.setAlwaysOnTop(true);
    } catch {
      void 0;
    }
    return;
  }
  const saved = readPetPosition();
  const petWindow = new WebviewWindow(PET_WINDOW_LABEL, {
    url: PET_WINDOW_URL,
    width: PET_WINDOW_SIZE,
    height: PET_WINDOW_SIZE,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    skipTaskbar: true,
    resizable: false,
    shadow: false,
    title: "Cybara Pet",
  });
  petWindow.once("tauri://created", () => {
    void petWindow.setVisibleOnAllWorkspaces(true).catch(() => undefined);
  });
}

export async function closePetWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(PET_WINDOW_LABEL);
  if (existing) {
    await existing.close();
  }
}

export async function listenForPetOpenSession(
  onOpen: (sessionId: string) => void
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ sessionId?: string }>(PET_OPEN_SESSION_EVENT, (event) => {
    onOpen(typeof event.payload?.sessionId === "string" ? event.payload.sessionId : "");
  });
  return unlisten;
}

export async function emitPetOpenSession(sessionId: string): Promise<void> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(PET_OPEN_SESSION_EVENT, { sessionId });
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const main = await WebviewWindow.getByLabel("main");
    if (main) {
      await main.show();
      await main.setFocus();
    }
  } catch {
    return;
  }
}

export async function startPetWindowDrag(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch {
    return;
  }
}

export async function persistPetWindowPosition(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const position = await getCurrentWindow().outerPosition();
    persistPetPosition({ x: position.x, y: position.y });
  } catch {
    return;
  }
}

export async function setPetWindowExpanded(expanded: boolean): Promise<void> {
  try {
    const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
    const size = expanded
      ? new LogicalSize(PET_WINDOW_EXPANDED.width, PET_WINDOW_EXPANDED.height)
      : new LogicalSize(PET_WINDOW_SIZE, PET_WINDOW_SIZE);
    await getCurrentWindow().setSize(size);
  } catch {
    return;
  }
}
