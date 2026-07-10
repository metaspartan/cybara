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

export type ThemeMode =
  | "system"
  | "dark"
  | "midnight"
  | "icy-dark"
  | "ash-grey"
  | "forest"
  | "sand-dune"
  | "light"
  | "paper"
  | "mint"
  | "lavender"
  | "cake";

export interface ThemeModeOption {
  value: ThemeMode;
  label: string;
  base: "system" | "dark" | "light";
  swatch: string;
}

export const themeModeOptions: ThemeModeOption[] = [
  { value: "system", label: "System", base: "system", swatch: "#6b7280" },
  { value: "dark", label: "Dark", base: "dark", swatch: "#0d0d12" },
  { value: "midnight", label: "Midnight", base: "dark", swatch: "#15102a" },
  { value: "icy-dark", label: "Icy Dark", base: "dark", swatch: "#081a2e" },
  { value: "ash-grey", label: "Ash Grey", base: "dark", swatch: "#1e2023" },
  { value: "forest", label: "Forest", base: "dark", swatch: "#0e1a12" },
  { value: "sand-dune", label: "Sand Dune", base: "dark", swatch: "#221c13" },
  { value: "light", label: "Light", base: "light", swatch: "#eef0f4" },
  { value: "paper", label: "Paper", base: "light", swatch: "#f7f3ec" },
  { value: "mint", label: "Mint", base: "light", swatch: "#edf7f2" },
  { value: "lavender", label: "Lavender", base: "light", swatch: "#f3f0fa" },
  { value: "cake", label: "Cake", base: "light", swatch: "#f9ecec" },
];

const themeModes = new Set<ThemeMode>(themeModeOptions.map((option) => option.value));

export function themeModeBase(mode: ThemeMode): "system" | "dark" | "light" {
  return themeModeOptions.find((option) => option.value === mode)?.base ?? "dark";
}

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

const resolveThemeMode = (mode: ThemeMode): "dark" | "light" => {
  const base = themeModeBase(mode);
  return base === "system" ? (prefersLightTheme() ? "light" : "dark") : base;
};

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

const TINTED_THEME_MODES = new Set<ThemeMode>([
  "midnight",
  "icy-dark",
  "ash-grey",
  "forest",
  "sand-dune",
  "paper",
  "mint",
  "lavender",
  "cake",
]);

function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  activeThemeMode = mode;
  ensureSystemThemeListener();
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.classList.toggle("light", resolveThemeMode(mode) === "light");
  document.documentElement.classList.toggle("theme-tinted", TINTED_THEME_MODES.has(mode));
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
