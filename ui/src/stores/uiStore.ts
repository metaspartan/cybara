import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Toast } from "../types";

export type ThemeAccent =
  | "indigo"
  | "emerald"
  | "amber"
  | "rose"
  | "cyan"
  | "purple"
  | "blue"
  | "teal"
  | "orange"
  | "pink";

export const themeAccents: Record<ThemeAccent, { primary: string; name: string }> = {
  indigo: { primary: "99, 102, 241", name: "Indigo" },
  blue: { primary: "59, 130, 246", name: "Blue" },
  cyan: { primary: "6, 182, 212", name: "Cyan" },
  teal: { primary: "20, 184, 166", name: "Teal" },
  emerald: { primary: "16, 185, 129", name: "Emerald" },
  amber: { primary: "245, 158, 11", name: "Amber" },
  orange: { primary: "249, 115, 22", name: "Orange" },
  rose: { primary: "244, 63, 94", name: "Rose" },
  pink: { primary: "236, 72, 153", name: "Pink" },
  purple: { primary: "168, 85, 247", name: "Purple" },
};

export const themeAccentKeys = Object.keys(themeAccents) as ThemeAccent[];

const themeAccentKeySet = new Set<string>(themeAccentKeys);

function readNestedString(
  record: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  let current: unknown = record;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : undefined;
}

export function readThemeAccentFromConfig(
  config: Record<string, unknown> | undefined
): ThemeAccent | undefined {
  const candidates = [
    config?.themeAccent,
    config?.theme_accent,
    config?.theme,
    config?.accent,
    config?.ui_accent,
    readNestedString(config, ["ui", "accent"]),
    readNestedString(config, ["appearance", "accent"]),
    readNestedString(config, ["settings", "accent"]),
    readNestedString(config, ["identity", "accent"]),
    readNestedString(config, ["identity", "theme"]),
  ];
  const value = candidates
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim().toLowerCase())
    .find((candidate) => themeAccentKeySet.has(candidate));
  return value as ThemeAccent | undefined;
}

export function themeConfigPayload(accent: ThemeAccent): Record<string, string> {
  return {
    theme: accent,
    themeAccent: accent,
    theme_accent: accent,
    ui_accent: accent,
  };
}

export type ThemeMode = "system" | "dark" | "light";

const themeModes = new Set<ThemeMode>(["system", "dark", "light"]);

export function readThemeModeFromIdentity(
  identity: Record<string, unknown> | undefined
): ThemeMode {
  return typeof identity?.theme === "string" && themeModes.has(identity.theme as ThemeMode)
    ? (identity.theme as ThemeMode)
    : "dark";
}

interface UIState {
  accent: ThemeAccent;
  setAccent: (accent: ThemeAccent) => void;

  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;

  loading: Record<string, boolean>;
  setLoading: (key: string, value: boolean) => void;

  toasts: Toast[];
  addToast: (type: Toast["type"], message: string) => void;
  removeToast: (id: string) => void;

  activeModal: string | null;
  modalData: unknown;
  openModal: (modal: string, data?: unknown) => void;
  closeModal: () => void;

  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

const applyTheme = (accent: ThemeAccent) => {
  if (typeof document === "undefined") return;
  const colors = themeAccents[accent];
  document.documentElement.style.setProperty("--accent-primary", colors.primary);
};

const systemThemeQuery = "(prefers-color-scheme: light)";
let activeThemeMode: ThemeMode = "dark";
let systemThemeListenerBound = false;

const prefersLightTheme = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(systemThemeQuery).matches;

const resolveThemeMode = (mode: ThemeMode): "dark" | "light" =>
  mode === "system" ? (prefersLightTheme() ? "light" : "dark") : mode;

const ensureSystemThemeListener = () => {
  if (
    systemThemeListenerBound ||
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return;
  }
  const query = window.matchMedia(systemThemeQuery);
  const onSystemThemeChange = () => {
    if (activeThemeMode === "system") applyThemeMode("system");
  };
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onSystemThemeChange);
  } else if (typeof query.addListener === "function") {
    query.addListener(onSystemThemeChange);
  }
  systemThemeListenerBound = true;
};

function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  activeThemeMode = mode;
  ensureSystemThemeListener();
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.classList.toggle("light", resolveThemeMode(mode) === "light");
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      accent: "indigo",
      setAccent: (accent) => {
        applyTheme(accent);
        set({ accent });
      },

      mode: "dark",
      setMode: (mode) => {
        applyThemeMode(mode);
        set({ mode });
      },

      loading: {},
      setLoading: (key, value) =>
        set((state) => ({
          loading: { ...state.loading, [key]: value },
        })),

      toasts: [],
      addToast: (type, message) => {
        const id = Math.random().toString(36).slice(2);
        set((state) => ({
          toasts: [...state.toasts, { id, type, message }],
        }));
        setTimeout(() => {
          set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
          }));
        }, 5000);
      },
      removeToast: (id) =>
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        })),

      activeModal: null,
      modalData: null,
      openModal: (modal, data) => set({ activeModal: modal, modalData: data }),
      closeModal: () => set({ activeModal: null, modalData: null }),

      sidebarOpen: true,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    }),
    {
      name: "cybara-ui-settings",
      partialize: (state) => ({ accent: state.accent, mode: state.mode }),
      onRehydrateStorage: () => (state) => {
        if (state?.accent) applyTheme(state.accent);
        applyThemeMode(
          themeModes.has(state?.mode as ThemeMode) ? (state?.mode as ThemeMode) : "dark"
        );
      },
    }
  )
);
