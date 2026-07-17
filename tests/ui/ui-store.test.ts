import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  defaultThemeAccentForMode,
  readThemeAccentFromConfig,
  readThemeModeFromIdentity,
  resolveThemeSelectionMode,
  themeAccentKeys,
  themeAccents,
  themeConfigPayload,
  useUIStore,
} from "../../ui/src/stores/uiStore";
import { DEFAULT_CHAT_APPEARANCE_SETTINGS } from "../../shared/chat-appearance";
import { createCustomThemeBundle } from "../../shared/custom-themes";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STORE_PATH = join(ROOT_DIR, "ui", "src", "stores", "uiStore.ts").replace(/\\/g, "/");

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const g = globalThis as { localStorage?: unknown };
let hadStorage: boolean;
let originalStorage: unknown;
const initialState = useUIStore.getState();
const originalWarn = console.warn;

beforeEach(() => {
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes("[zustand persist middleware]")) return;
    originalWarn(...args);
  };
  hadStorage = "localStorage" in g;
  originalStorage = g.localStorage;
  g.localStorage = makeStorage();
  useUIStore.setState({
    accent: "indigo",
    mode: "dark",
    customThemes: [],
    activeCustomThemeId: null,
    chatAppearance: DEFAULT_CHAT_APPEARANCE_SETTINGS,
    loading: {},
    toasts: [],
    activeModal: null,
    modalData: null,
    sidebarOpen: true,
  });
});

afterEach(() => {
  console.warn = originalWarn;
  if (hadStorage) {
    g.localStorage = originalStorage;
  } else {
    delete g.localStorage;
  }
});

describe("UI store theme helpers", () => {
  test("theme modes resolve to matching default accents", () => {
    expect(defaultThemeAccentForMode("dark")).toBe("indigo");
    expect(defaultThemeAccentForMode("sand-dune")).toBe("amber");
    expect(defaultThemeAccentForMode("forest")).toBe("emerald");
    expect(defaultThemeAccentForMode("lavender")).toBe("purple");
    expect(defaultThemeAccentForMode("cake")).toBe("pink");
    expect(defaultThemeAccentForMode("unknown")).toBe("indigo");
  });

  test("every accent has a display name and rgb triple", () => {
    expect(themeAccentKeys.length).toBe(12);
    for (const key of themeAccentKeys) {
      const entry = themeAccents[key];
      expect(entry.primary).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  test("reads flat and nested accent aliases", () => {
    expect(readThemeAccentFromConfig({ themeAccent: "rose" })).toBe("rose");
    expect(readThemeAccentFromConfig({ theme_accent: "teal" })).toBe("teal");
    expect(readThemeAccentFromConfig({ theme: "amber" })).toBe("amber");
    expect(readThemeAccentFromConfig({ accent: "cyan" })).toBe("cyan");
    expect(readThemeAccentFromConfig({ ui_accent: "pink" })).toBe("pink");
    expect(readThemeAccentFromConfig({ ui: { accent: "emerald" } })).toBe("emerald");
    expect(readThemeAccentFromConfig({ appearance: { accent: "purple" } })).toBe("purple");
    expect(readThemeAccentFromConfig({ settings: { accent: "blue" } })).toBe("blue");
    expect(readThemeAccentFromConfig({ identity: { accent: "orange" } })).toBe("orange");
    expect(readThemeAccentFromConfig({ identity: { theme: "rose" } })).toBe("rose");
  });

  test("normalizes accent values and lets flat aliases win", () => {
    expect(readThemeAccentFromConfig({ theme: "  ROSE  " })).toBe("rose");
    expect(readThemeAccentFromConfig({ ui: { accent: " Emerald " } })).toBe("emerald");
    expect(readThemeAccentFromConfig({ themeAccent: "rose", ui: { accent: "teal" } })).toBe("rose");
    expect(readThemeAccentFromConfig({ theme: "dark", ui: { accent: "teal" } })).toBe("teal");
  });

  test("rejects malformed accent config without throwing", () => {
    expect(readThemeAccentFromConfig(undefined)).toBeUndefined();
    expect(readThemeAccentFromConfig({})).toBeUndefined();
    expect(readThemeAccentFromConfig({ theme: "dark" })).toBeUndefined();
    expect(
      readThemeAccentFromConfig({ theme: 42 } as unknown as Record<string, unknown>)
    ).toBeUndefined();
    expect(
      readThemeAccentFromConfig({ theme: null } as unknown as Record<string, unknown>)
    ).toBeUndefined();
    expect(
      readThemeAccentFromConfig({ ui: ["rose"] } as unknown as Record<string, unknown>)
    ).toBeUndefined();
    expect(readThemeAccentFromConfig({ ui: { accent: "" } })).toBeUndefined();
    expect(readThemeAccentFromConfig({ ui: { accent: "   " } })).toBeUndefined();
    expect(
      readThemeAccentFromConfig({ ui: "rose" } as unknown as Record<string, unknown>)
    ).toBeUndefined();
  });

  test("theme payload mirrors the accent into every persisted alias", () => {
    expect(themeConfigPayload("teal")).toEqual({
      theme: "teal",
      themeAccent: "teal",
      theme_accent: "teal",
      ui_accent: "teal",
    });
  });

  test("reads supported theme modes and falls back to dark", () => {
    expect(readThemeModeFromIdentity({ theme: "system" })).toBe("system");
    expect(readThemeModeFromIdentity({ theme: "light" })).toBe("light");
    expect(readThemeModeFromIdentity({ theme: "dark" })).toBe("dark");
    expect(readThemeModeFromIdentity(undefined)).toBe("dark");
    expect(readThemeModeFromIdentity({})).toBe("dark");
    expect(readThemeModeFromIdentity({ theme: "rose" })).toBe("dark");
    expect(readThemeModeFromIdentity({ theme: 5 } as unknown as Record<string, unknown>)).toBe(
      "dark"
    );
    expect(resolveThemeSelectionMode({ theme: "custom" }, null)).toBe("dark");
    expect(resolveThemeSelectionMode({ theme: "custom" }, "studio-night")).toBe("custom");
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("UI store theme config fuzz", () => {
  test("readThemeAccentFromConfig never throws and only returns valid accents", () => {
    const rand = mulberry32(0xacc);
    const keys = [
      "theme",
      "themeAccent",
      "accent",
      "ui",
      "appearance",
      "settings",
      "identity",
      "x",
    ];
    const leaves: unknown[] = [
      "rose",
      "ROSE ",
      "not-a-color",
      "",
      0,
      42,
      null,
      undefined,
      true,
      ["rose"],
      { accent: "teal" },
      { theme: 5 },
      Symbol("s"),
      () => "rose",
    ];
    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

    for (let i = 0; i < 500; i++) {
      const cfg: Record<string, unknown> = {};
      const fields = Math.floor(rand() * 4);
      for (let f = 0; f < fields; f++) {
        const key = pick(keys);
        cfg[key] = rand() < 0.4 ? { [pick(keys)]: pick(leaves) } : pick(leaves);
      }
      const result = readThemeAccentFromConfig(cfg);
      if (result !== undefined) {
        expect(themeAccentKeys).toContain(result);
      }
    }
  });
});

describe("useUIStore actions", () => {
  test("updates appearance, loading state, toasts, modals, and sidebar state", () => {
    useUIStore.getState().setAccent("rose");
    useUIStore.getState().setMode("system");
    useUIStore.getState().setChatAppearance({
      fontSize: "large",
      codeFontSize: "large",
      lineSpacing: "spacious",
      reduceMotion: true,
      reduceTransparency: true,
      highContrast: true,
      underlineLinks: true,
    });
    useUIStore.getState().setLoading("agents", true);
    useUIStore.getState().setLoading("chat", true);
    useUIStore.getState().setLoading("agents", false);
    useUIStore.getState().addToast("success", "saved");
    useUIStore.getState().addToast("error", "broke");
    useUIStore.getState().openModal("settings", { tab: "theme" });
    useUIStore.getState().toggleSidebar();

    const state = useUIStore.getState();
    expect(state.accent).toBe("rose");
    expect(state.mode).toBe("system");
    expect(state.chatAppearance).toEqual({
      fontSize: "large",
      codeFontSize: "large",
      lineSpacing: "spacious",
      reduceMotion: true,
      reduceTransparency: true,
      highContrast: true,
      underlineLinks: true,
    });
    expect(state.loading).toEqual({ agents: false, chat: true });
    expect(state.toasts.map((toast) => toast.message)).toEqual(["saved", "broke"]);
    expect(state.toasts[0].id).not.toBe(state.toasts[1].id);
    expect(state.activeModal).toBe("settings");
    expect(state.modalData).toEqual({ tab: "theme" });
    expect(state.sidebarOpen).toBe(false);

    state.removeToast(state.toasts[0].id);
    expect(useUIStore.getState().toasts.map((toast) => toast.message)).toEqual(["broke"]);

    state.closeModal();
    expect(useUIStore.getState().activeModal).toBeNull();
  });

  test("selects, updates, and removes a custom theme", () => {
    const theme = createCustomThemeBundle("Studio Night");
    useUIStore.getState().upsertCustomTheme(theme);
    useUIStore.getState().selectCustomTheme(theme.id);
    expect(useUIStore.getState().mode).toBe("custom");
    expect(useUIStore.getState().activeCustomThemeId).toBe(theme.id);

    useUIStore.getState().upsertCustomTheme({
      ...theme,
      dark: { ...theme.dark, accent: "#ff3366" },
    });
    expect(useUIStore.getState().customThemes[0]?.dark.accent).toBe("#ff3366");

    useUIStore.getState().removeCustomTheme(theme.id);
    expect(useUIStore.getState().customThemes).toEqual([]);
    expect(useUIStore.getState().activeCustomThemeId).toBeNull();
    expect(useUIStore.getState().mode).toBe("dark");
  });
});

interface PersistenceReport {
  persistedAfterSet: { state: Record<string, unknown> } | null;
  rehydratedAccent: string;
  rehydratedMode: string;
  garbageRehydrateThrew: boolean;
  accentAfterGarbage: string;
  hasPersistApi: boolean;
}

function runPersistenceWorker(): PersistenceReport {
  const dir = mkdtempSync(join(tmpdir(), "cybara-uistore-"));
  try {
    writeFileSync(
      join(dir, "shim.ts"),
      `
const store = new Map<string, string>();
const shim = {
  get length() {
    return store.size;
  },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
const g = globalThis as { localStorage?: unknown; window?: unknown };
g.localStorage = shim;
g.window = { localStorage: shim };
`,
      "utf8"
    );
    writeFileSync(
      join(dir, "worker.ts"),
      `
import "./shim.ts";
import { useUIStore } from "${STORE_PATH}";

const ls = (globalThis as { localStorage: Storage }).localStorage;

useUIStore.getState().setAccent("amber");
useUIStore.getState().setMode("system");
useUIStore.getState().setChatAppearance({
  fontSize: "large",
  codeFontSize: "large",
  lineSpacing: "spacious",
  reduceMotion: true,
  reduceTransparency: true,
  highContrast: true,
  underlineLinks: true,
});
useUIStore.getState().setLoading("x", true);
useUIStore.getState().openModal("m");
const raw = ls.getItem("cybara-ui-settings");
const persistedAfterSet = raw ? JSON.parse(raw) : null;

ls.setItem("cybara-ui-settings", JSON.stringify({ state: { accent: "purple" }, version: 0 }));
await useUIStore.persist.rehydrate();
const rehydratedAccent = useUIStore.getState().accent;
const rehydratedMode = useUIStore.getState().mode;

ls.setItem("cybara-ui-settings", "{definitely not json");
let garbageRehydrateThrew = false;
try {
  await useUIStore.persist.rehydrate();
} catch {
  garbageRehydrateThrew = true;
}

console.log(
  "@@REPORT@@" +
    JSON.stringify({
      persistedAfterSet,
      rehydratedAccent,
      rehydratedMode,
      garbageRehydrateThrew,
      accentAfterGarbage: useUIStore.getState().accent,
      hasPersistApi: typeof useUIStore.persist?.rehydrate === "function",
    })
);
`,
      "utf8"
    );
    const result = Bun.spawnSync([process.execPath, "run", join(dir, "worker.ts")], {
      cwd: dirname(STORE_PATH),
    });
    const stdout = result.stdout.toString();
    if (result.exitCode !== 0) {
      throw new Error(`uiStore worker failed: ${result.stderr.toString()}\n${stdout}`);
    }
    const line = stdout.split("\n").find((value) => value.startsWith("@@REPORT@@"));
    if (!line) throw new Error(`no report in worker output:\n${stdout}`);
    return JSON.parse(line.slice("@@REPORT@@".length)) as PersistenceReport;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("useUIStore persistence", () => {
  const report = runPersistenceWorker();

  test("exposes the persist API when storage is available at load time", () => {
    expect(report.hasPersistApi).toBe(true);
  });

  test("persists only appearance settings", () => {
    expect(report.persistedAfterSet).not.toBeNull();
    expect(report.persistedAfterSet?.state).toEqual({
      accent: "amber",
      mode: "system",
      customThemes: [],
      activeCustomThemeId: null,
      chatAppearance: {
        fontSize: "large",
        codeFontSize: "large",
        lineSpacing: "spacious",
        reduceMotion: true,
        reduceTransparency: true,
        highContrast: true,
        underlineLinks: true,
      },
    });
  });

  test("rehydrates appearance settings from storage", () => {
    expect(report.rehydratedAccent).toBe("purple");
    expect(report.rehydratedMode).toBe("system");
  });

  test("rehydrating garbage storage does not throw and keeps a valid accent", () => {
    expect(report.garbageRehydrateThrew).toBe(false);
    expect(themeAccentKeys).toContain(report.accentAfterGarbage);
    expect(typeof initialState.setAccent).toBe("function");
  });
});
