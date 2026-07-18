import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Toast } from "../types";
import {
  type ChatAppearanceSettings,
  DEFAULT_CHAT_APPEARANCE_SETTINGS,
  getChatCodeFontSizePixels,
  getChatFontSizePixels,
  getChatLineHeight,
  normalizeChatAppearanceSettings,
} from "../../../shared/chat-appearance";
import {
  type CustomThemeBundle,
  type CustomThemeCollection,
  MAX_CUSTOM_THEMES,
  normalizeCustomThemeBundle,
  normalizeCustomThemeCollection,
} from "../../../shared/custom-themes";
export { defaultThemeAccentForMode } from "../../../shared/theme-defaults";
export type {
  CustomThemeBundle,
  CustomThemeCollection,
  CustomThemePalette,
  CustomThemeScheme,
} from "../../../shared/custom-themes";

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
  | "pink"
  | "catppuccin"
  | "matrix";

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
  catppuccin: { primary: "203, 166, 247", name: "Catppuccin Mauve" },
  matrix: { primary: "57, 255, 104", name: "Matrix Green" },
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

export function customThemeConfigPayload(
  themes: CustomThemeBundle[],
  activeThemeId: string | null
): { custom_themes: CustomThemeCollection } {
  return {
    custom_themes: normalizeCustomThemeCollection({ version: 1, activeThemeId, themes }),
  };
}

export function readCustomThemeCollectionFromConfig(
  config: Record<string, unknown> | undefined
): CustomThemeCollection {
  return normalizeCustomThemeCollection(config?.custom_themes);
}

export type ThemeMode =
  | "system"
  | "dark"
  | "midnight"
  | "icy-dark"
  | "ash-grey"
  | "forest"
  | "catppuccin"
  | "matrix"
  | "slate"
  | "sand-dune"
  | "light"
  | "icy"
  | "paper"
  | "mint"
  | "lavender"
  | "cake"
  | "custom";

export interface ThemeModeOption {
  value: ThemeMode;
  label: string;
  base: "system" | "dark" | "light";
  swatch: string;
}

export const themeModeOptions: ThemeModeOption[] = [
  { value: "system", label: "System", base: "system", swatch: "#6b7280" },
  { value: "dark", label: "Dark", base: "dark", swatch: "#1f2937" },
  { value: "midnight", label: "Midnight", base: "dark", swatch: "#8b5cf6" },
  { value: "icy-dark", label: "Icy Dark", base: "dark", swatch: "#38bdf8" },
  { value: "ash-grey", label: "Ash Grey", base: "dark", swatch: "#9ca3af" },
  { value: "forest", label: "Forest", base: "dark", swatch: "#34d399" },
  { value: "catppuccin", label: "Catppuccin", base: "dark", swatch: "#cba6f7" },
  { value: "matrix", label: "Matrix", base: "dark", swatch: "#39ff68" },
  { value: "slate", label: "Slate", base: "dark", swatch: "#64748b" },
  { value: "sand-dune", label: "Sand Dune", base: "dark", swatch: "#d69a46" },
  { value: "light", label: "Light", base: "light", swatch: "#e2e8f0" },
  { value: "icy", label: "Icy", base: "light", swatch: "#0ea5e9" },
  { value: "paper", label: "Paper", base: "light", swatch: "#d9b882" },
  { value: "mint", label: "Mint", base: "light", swatch: "#10b981" },
  { value: "lavender", label: "Lavender", base: "light", swatch: "#a855f7" },
  { value: "cake", label: "Cake", base: "light", swatch: "#f472b6" },
];

const themeModes = new Set<ThemeMode>([
  ...themeModeOptions.map((option) => option.value),
  "custom",
]);

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

export function resolveThemeSelectionMode(
  identity: Record<string, unknown> | undefined,
  activeCustomThemeId: string | null
): ThemeMode {
  const mode = readThemeModeFromIdentity(identity);
  return mode === "custom" && !activeCustomThemeId ? "dark" : mode;
}

interface UIState {
  accent: ThemeAccent;
  setAccent: (accent: ThemeAccent) => void;

  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;

  customThemes: CustomThemeBundle[];
  activeCustomThemeId: string | null;
  setCustomThemeCollection: (collection: CustomThemeCollection) => void;
  upsertCustomTheme: (theme: CustomThemeBundle) => void;
  removeCustomTheme: (id: string) => void;
  selectCustomTheme: (id: string) => void;

  chatAppearance: ChatAppearanceSettings;
  setChatAppearance: (settings: ChatAppearanceSettings) => void;

  chatEnvironmentOpen: boolean;
  setChatEnvironmentOpen: (open: boolean) => void;

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

let activeAccentPrimary = themeAccents.indigo.primary;

const applyTheme = (accent: ThemeAccent) => {
  activeAccentPrimary = themeAccents[accent].primary;
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--accent-primary", activeAccentPrimary);
};

const customThemeProperties = [
  "--surface-backdrop",
  "--surface-panel",
  "--surface-raised",
  "--surface-hover",
  "--surface-border",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text-subtle",
  "--icon-muted",
  "--icon-hover",
  "--glass-border",
  "--glass-surface",
  "--glass-bg",
  "--glass-bg-strong",
  "--context-ring-inner",
  "--context-tooltip-bg",
  "--context-tooltip-border",
  "--chat-environment-panel-bg",
  "--chat-environment-panel-border",
  "--workspace-open-menu-bg",
  "--font-ui",
  "--font-mono",
] as const;

function clearCustomThemeProperties(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const property of customThemeProperties) root.style.removeProperty(property);
  root.style.setProperty("--accent-primary", activeAccentPrimary);
  root.style.removeProperty("color-scheme");
  delete root.dataset.customTheme;
  delete root.dataset.translucentSidebar;
}

function hexRgb(value: string): string {
  return [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)]
    .map((channel) => Number.parseInt(channel, 16))
    .join(", ");
}

const systemThemeQuery = "(prefers-color-scheme: light)";
let activeThemeMode: ThemeMode = "dark";
let activeCustomTheme: CustomThemeBundle | null = null;
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
    if (activeThemeMode === "custom" && activeCustomTheme) applyCustomTheme(activeCustomTheme);
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
  "catppuccin",
  "matrix",
  "slate",
  "sand-dune",
  "icy",
  "paper",
  "mint",
  "lavender",
  "cake",
]);

function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  if (mode === "custom") {
    if (activeCustomTheme) applyCustomTheme(activeCustomTheme);
    return;
  }
  activeCustomTheme = null;
  clearCustomThemeProperties();
  activeThemeMode = mode;
  ensureSystemThemeListener();
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.classList.toggle("light", resolveThemeMode(mode) === "light");
  document.documentElement.classList.toggle("theme-tinted", TINTED_THEME_MODES.has(mode));
}

function applyCustomTheme(theme: CustomThemeBundle): void {
  if (typeof document === "undefined") return;
  activeThemeMode = "custom";
  activeCustomTheme = theme;
  ensureSystemThemeListener();
  const light = theme.scheme === "light" || (theme.scheme === "system" && prefersLightTheme());
  const palette = light ? theme.light : theme.dark;
  const root = document.documentElement;
  const highContrast = root.dataset.highContrast === "true";
  const reduceTransparency = root.dataset.reduceTransparency === "true";
  const contrast = Math.max(0, Math.min(100, theme.contrast));
  const secondaryWeight = Math.round(62 + contrast * 0.32);
  const borderWeight = Math.round(38 + contrast * 0.42);
  const secondary = highContrast
    ? palette.foreground
    : `color-mix(in srgb, ${palette.foreground} ${secondaryWeight}%, ${palette.background})`;
  const border = highContrast
    ? `color-mix(in srgb, ${palette.foreground} 46%, ${palette.background})`
    : `color-mix(in srgb, ${palette.border} ${borderWeight}%, ${palette.background})`;
  root.dataset.themeMode = "custom";
  root.dataset.customTheme = theme.id;
  root.dataset.translucentSidebar = theme.translucentSidebar ? "true" : "false";
  root.classList.toggle("light", light);
  root.classList.add("theme-tinted");
  root.style.colorScheme = light ? "light" : "dark";
  root.style.setProperty("--accent-primary", hexRgb(palette.accent));
  root.style.setProperty("--surface-backdrop", palette.background);
  root.style.setProperty("--surface-panel", palette.panel);
  root.style.setProperty("--surface-raised", palette.raised);
  root.style.setProperty("--surface-hover", palette.hover);
  root.style.setProperty("--surface-border", border);
  root.style.setProperty("--text-primary", palette.foreground);
  root.style.setProperty("--text-secondary", secondary);
  root.style.setProperty("--text-muted", highContrast ? secondary : palette.muted);
  root.style.setProperty("--text-subtle", highContrast ? secondary : palette.subtle);
  root.style.setProperty("--icon-muted", highContrast ? secondary : palette.muted);
  root.style.setProperty("--icon-hover", palette.foreground);
  root.style.setProperty("--glass-border", border);
  root.style.setProperty(
    "--glass-surface",
    reduceTransparency ? palette.raised : `color-mix(in srgb, ${palette.panel} 82%, transparent)`
  );
  root.style.setProperty(
    "--glass-bg",
    reduceTransparency ? palette.panel : `color-mix(in srgb, ${palette.panel} 78%, transparent)`
  );
  root.style.setProperty(
    "--glass-bg-strong",
    reduceTransparency ? palette.panel : `color-mix(in srgb, ${palette.panel} 96%, transparent)`
  );
  root.style.setProperty("--context-ring-inner", palette.panel);
  root.style.setProperty("--context-tooltip-bg", palette.panel);
  root.style.setProperty("--context-tooltip-border", palette.border);
  root.style.setProperty("--chat-environment-panel-bg", palette.panel);
  root.style.setProperty("--chat-environment-panel-border", palette.border);
  root.style.setProperty("--workspace-open-menu-bg", palette.raised);
  root.style.setProperty("--font-ui", theme.uiFont);
  root.style.setProperty("--font-mono", theme.codeFont);
}

function applyChatAppearance(settings: ChatAppearanceSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--chat-font-size", `${getChatFontSizePixels(settings.fontSize)}px`);
  root.style.setProperty(
    "--chat-code-font-size",
    `${getChatCodeFontSizePixels(settings.codeFontSize)}px`
  );
  root.style.setProperty("--chat-line-height", String(getChatLineHeight(settings.lineSpacing)));
  root.dataset.reduceMotion = settings.reduceMotion ? "true" : "false";
  root.dataset.reduceTransparency = settings.reduceTransparency ? "true" : "false";
  root.dataset.highContrast = settings.highContrast ? "true" : "false";
  root.dataset.underlineLinks = settings.underlineLinks ? "true" : "false";
  if (activeThemeMode === "custom" && activeCustomTheme) applyCustomTheme(activeCustomTheme);
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
        set({ mode, ...(mode === "custom" ? {} : { activeCustomThemeId: null }) });
      },

      customThemes: [],
      activeCustomThemeId: null,
      setCustomThemeCollection: (collection) => {
        const normalized = normalizeCustomThemeCollection(collection);
        set((state) => {
          const active = normalized.themes.find((theme) => theme.id === normalized.activeThemeId);
          if (active) applyCustomTheme(active);
          if (!active && state.mode === "custom") applyThemeMode("dark");
          return {
            customThemes: normalized.themes,
            activeCustomThemeId: normalized.activeThemeId,
            ...(active
              ? { mode: "custom" as ThemeMode }
              : state.mode === "custom"
                ? { mode: "dark" as ThemeMode }
                : {}),
          };
        });
      },
      upsertCustomTheme: (theme) => {
        const normalized = normalizeCustomThemeBundle(theme);
        if (!normalized) return;
        set((state) => {
          const existing = state.customThemes.findIndex((entry) => entry.id === normalized.id);
          const customThemes = [...state.customThemes];
          if (existing >= 0) customThemes[existing] = normalized;
          else if (customThemes.length < MAX_CUSTOM_THEMES) customThemes.push(normalized);
          if (state.activeCustomThemeId === normalized.id) applyCustomTheme(normalized);
          return { customThemes };
        });
      },
      removeCustomTheme: (id) => {
        set((state) => {
          const customThemes = state.customThemes.filter((theme) => theme.id !== id);
          if (state.activeCustomThemeId !== id) return { customThemes };
          applyThemeMode("dark");
          return { customThemes, activeCustomThemeId: null, mode: "dark" as ThemeMode };
        });
      },
      selectCustomTheme: (id) => {
        set((state) => {
          const theme = state.customThemes.find((entry) => entry.id === id);
          if (!theme) return {};
          applyCustomTheme(theme);
          return { activeCustomThemeId: id, mode: "custom" as ThemeMode };
        });
      },

      chatAppearance: DEFAULT_CHAT_APPEARANCE_SETTINGS,
      setChatAppearance: (settings) => {
        const normalized = normalizeChatAppearanceSettings(settings);
        applyChatAppearance(normalized);
        set({ chatAppearance: normalized });
      },

      chatEnvironmentOpen: false,
      setChatEnvironmentOpen: (open) => set({ chatEnvironmentOpen: open }),

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
      partialize: (state) => ({
        accent: state.accent,
        mode: state.mode,
        customThemes: state.customThemes,
        activeCustomThemeId: state.activeCustomThemeId,
        chatAppearance: state.chatAppearance,
        chatEnvironmentOpen: state.chatEnvironmentOpen,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accent) applyTheme(state.accent);
        const collection = normalizeCustomThemeCollection({
          version: 1,
          themes: state?.customThemes,
          activeThemeId: state?.activeCustomThemeId,
        });
        const active = collection.themes.find((theme) => theme.id === collection.activeThemeId);
        if (state) {
          state.customThemes = collection.themes;
          state.activeCustomThemeId = collection.activeThemeId;
          if (active && state.mode === "custom") applyCustomTheme(active);
          else {
            if (state.mode === "custom") state.mode = "dark";
            applyThemeMode(themeModes.has(state.mode) ? state.mode : "dark");
          }
          state.setChatAppearance(
            normalizeChatAppearanceSettings(
              state.chatAppearance ?? DEFAULT_CHAT_APPEARANCE_SETTINGS
            )
          );
        }
      },
    }
  )
);
