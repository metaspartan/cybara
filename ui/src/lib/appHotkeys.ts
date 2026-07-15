export type AppHotkeyActionId =
  | "newChat"
  | "focusComposer"
  | "toggleWorkspace"
  | "openChat"
  | "openIde"
  | "openTerminal"
  | "openSettings"
  | "toggleSidebar";

export interface AppHotkeyDefinition {
  id: AppHotkeyActionId;
  label: string;
  category: "Chat" | "Navigation" | "Layout";
  defaultBinding: string;
}

export const APP_HOTKEYS: readonly AppHotkeyDefinition[] = [
  {
    id: "newChat",
    label: "New chat",
    category: "Chat",
    defaultBinding: "mod+shift+n",
  },
  {
    id: "focusComposer",
    label: "Focus chat input",
    category: "Chat",
    defaultBinding: "mod+shift+l",
  },
  {
    id: "toggleWorkspace",
    label: "Toggle chat workspace",
    category: "Chat",
    defaultBinding: "mod+shift+\\",
  },
  {
    id: "openChat",
    label: "Open chat",
    category: "Navigation",
    defaultBinding: "mod+1",
  },
  {
    id: "openIde",
    label: "Open IDE",
    category: "Navigation",
    defaultBinding: "mod+2",
  },
  {
    id: "openTerminal",
    label: "Open terminal",
    category: "Navigation",
    defaultBinding: "mod+3",
  },
  {
    id: "openSettings",
    label: "Open settings",
    category: "Navigation",
    defaultBinding: "mod+,",
  },
  {
    id: "toggleSidebar",
    label: "Toggle sidebar",
    category: "Layout",
    defaultBinding: "mod+b",
  },
];

export const APP_HOTKEY_EVENT = "cybara:app-hotkey";
export const APP_HOTKEYS_CHANGED_EVENT = "cybara:app-hotkeys-changed";

const APP_HOTKEY_STORAGE_KEY = "cybara.app.hotkeys.v1";
const PENDING_CHAT_HOTKEY_KEY = "cybara.pending-chat-hotkey.v1";
const MODIFIER_KEYS = new Set(["alt", "altgraph", "control", "meta", "os", "shift"]);

function normalizeKeyToken(event: KeyboardEvent): string {
  if (event.code === "Backquote") return "`";
  if (event.code === "Backslash") return "\\";
  if (event.key === " " || event.key === "Spacebar") return "space";
  return event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
}

export function bindingFromKeyboardEvent(event: KeyboardEvent): string {
  if (MODIFIER_KEYS.has(event.key.toLowerCase())) return "";
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(normalizeKeyToken(event));
  return parts.join("+");
}

export function formatAppHotkey(binding: string, isMac: boolean): string {
  if (!binding) return "Unassigned";
  return binding
    .split("+")
    .map((token) => {
      if (token === "mod") return isMac ? "⌘" : "Ctrl";
      if (token === "shift") return isMac ? "⇧" : "Shift";
      if (token === "alt") return isMac ? "⌥" : "Alt";
      if (token === "space") return "Space";
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join(isMac ? "" : "+");
}

export function readAppHotkeyOverrides(): Partial<Record<AppHotkeyActionId, string>> {
  try {
    const raw = window.localStorage.getItem(APP_HOTKEY_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Partial<Record<AppHotkeyActionId, string>> = {};
    for (const definition of APP_HOTKEYS) {
      const value = (parsed as Record<string, unknown>)[definition.id];
      if (typeof value === "string") result[definition.id] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function resolveAppHotkeys(
  overrides: Partial<Record<AppHotkeyActionId, string>>
): Record<AppHotkeyActionId, string> {
  return APP_HOTKEYS.reduce<Record<AppHotkeyActionId, string>>(
    (result, definition) => {
      result[definition.id] = overrides[definition.id] ?? definition.defaultBinding;
      return result;
    },
    {} as Record<AppHotkeyActionId, string>
  );
}

export function writeAppHotkeyOverrides(
  overrides: Partial<Record<AppHotkeyActionId, string>>
): void {
  window.localStorage.setItem(APP_HOTKEY_STORAGE_KEY, JSON.stringify(overrides));
  window.dispatchEvent(new Event(APP_HOTKEYS_CHANGED_EVENT));
}

export function appHotkeyActionForEvent(
  event: KeyboardEvent,
  bindings: Record<AppHotkeyActionId, string>
): AppHotkeyActionId | null {
  const binding = bindingFromKeyboardEvent(event);
  return APP_HOTKEYS.find((definition) => bindings[definition.id] === binding)?.id ?? null;
}

export function dispatchAppHotkey(action: AppHotkeyActionId): void {
  window.dispatchEvent(new CustomEvent<AppHotkeyActionId>(APP_HOTKEY_EVENT, { detail: action }));
}

export function storePendingChatHotkey(action: AppHotkeyActionId): void {
  window.sessionStorage.setItem(PENDING_CHAT_HOTKEY_KEY, action);
}

export function consumePendingChatHotkey(): AppHotkeyActionId | null {
  const value = window.sessionStorage.getItem(PENDING_CHAT_HOTKEY_KEY);
  window.sessionStorage.removeItem(PENDING_CHAT_HOTKEY_KEY);
  return APP_HOTKEYS.some((definition) => definition.id === value)
    ? (value as AppHotkeyActionId)
    : null;
}
