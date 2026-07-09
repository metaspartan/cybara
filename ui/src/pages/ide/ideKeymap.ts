export type IdeActionId =
  | "commandPalette"
  | "quickOpen"
  | "openSettings"
  | "toggleTerminal"
  | "newTerminal"
  | "searchInFiles"
  | "focusExplorer"
  | "focusOutline"
  | "openWorkspace"
  | "newFile"
  | "toggleChat";

export interface IdeActionDef {
  id: IdeActionId;
  label: string;
  category: string;
  defaultBinding: string;
}

// Bindings are canonical strings: modifiers ("mod" = ⌘ on macOS / Ctrl elsewhere,
// plus "shift"/"alt"/"ctrl") joined with "+", ending in a key token. Defaults
// mirror the common Zed / VS Code shortcuts.
export const IDE_ACTIONS: readonly IdeActionDef[] = [
  { id: "commandPalette", label: "Command Palette", category: "General", defaultBinding: "mod+shift+p" },
  { id: "quickOpen", label: "Go to File", category: "Navigation", defaultBinding: "mod+p" },
  { id: "openSettings", label: "Open IDE Settings", category: "General", defaultBinding: "mod+," },
  { id: "toggleTerminal", label: "Toggle Terminal", category: "Panels", defaultBinding: "mod+`" },
  { id: "newTerminal", label: "New Terminal", category: "Panels", defaultBinding: "mod+shift+`" },
  { id: "searchInFiles", label: "Search in Files", category: "Navigation", defaultBinding: "mod+shift+f" },
  { id: "focusExplorer", label: "Focus Explorer", category: "Panels", defaultBinding: "mod+shift+e" },
  { id: "focusOutline", label: "Focus Outline", category: "Panels", defaultBinding: "mod+shift+o" },
  { id: "openWorkspace", label: "Open Workspace…", category: "General", defaultBinding: "mod+o" },
  { id: "newFile", label: "New File", category: "General", defaultBinding: "mod+n" },
  { id: "toggleChat", label: "Toggle AI Chat", category: "Panels", defaultBinding: "mod+\\" },
];

const KEYMAP_STORAGE_KEY = "cybara.ide.keymap.v1";

function normalizeKeyToken(event: KeyboardEvent): string {
  if (event.code === "Backquote") return "`";
  const key = event.key;
  if (key === " " || key === "Spacebar") return "space";
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

export function bindingFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(normalizeKeyToken(event));
  return parts.join("+");
}

export function eventMatchesBinding(event: KeyboardEvent, binding: string): boolean {
  if (!binding) return false;
  return bindingFromEvent(event) === binding;
}

export function formatBinding(binding: string, isMac: boolean): string {
  if (!binding) return "Unassigned";
  return binding
    .split("+")
    .map((token) => {
      switch (token) {
        case "mod":
          return isMac ? "⌘" : "Ctrl";
        case "shift":
          return isMac ? "⇧" : "Shift";
        case "alt":
          return isMac ? "⌥" : "Alt";
        case "ctrl":
          return "Ctrl";
        case "space":
          return "Space";
        case "`":
          return "`";
        default:
          return token.length === 1 ? token.toUpperCase() : token.replace(/^\w/, (c) => c.toUpperCase());
      }
    })
    .join(isMac ? "" : "+");
}

export function loadKeymapOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEYMAP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveKeymap(overrides: Record<string, string>): Record<IdeActionId, string> {
  const map = {} as Record<IdeActionId, string>;
  for (const action of IDE_ACTIONS) {
    const override = overrides[action.id];
    map[action.id] = typeof override === "string" ? override : action.defaultBinding;
  }
  return map;
}

export function persistKeymapOverrides(overrides: Record<string, string>): void {
  try {
    window.localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore persistence errors */
  }
}
