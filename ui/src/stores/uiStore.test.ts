import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  readThemeAccentFromConfig,
  themeAccentKeys,
  themeAccents,
  themeConfigPayload,
  useUIStore,
} from './uiStore';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'uiStore.ts').replace(/\\/g, '/');

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
let storage: ReturnType<typeof makeStorage>;

const initialState = useUIStore.getState();
const originalWarn = console.warn;

beforeEach(() => {
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes('[zustand persist middleware]')) return;
    originalWarn(...args);
  };
  hadStorage = 'localStorage' in g;
  originalStorage = g.localStorage;
  storage = makeStorage();
  g.localStorage = storage;
  useUIStore.setState({
    accent: 'indigo',
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

describe('theme accent catalog', () => {
  test('every accent has an rgb triple and display name', () => {
    expect(themeAccentKeys.length).toBe(10);
    for (const key of themeAccentKeys) {
      const entry = themeAccents[key];
      expect(entry.primary).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });
});

describe('readThemeAccentFromConfig', () => {
  test('reads each supported flat key', () => {
    expect(readThemeAccentFromConfig({ themeAccent: 'rose' })).toBe('rose');
    expect(readThemeAccentFromConfig({ theme_accent: 'teal' })).toBe('teal');
    expect(readThemeAccentFromConfig({ theme: 'amber' })).toBe('amber');
    expect(readThemeAccentFromConfig({ accent: 'cyan' })).toBe('cyan');
    expect(readThemeAccentFromConfig({ ui_accent: 'pink' })).toBe('pink');
  });

  test('reads nested shapes', () => {
    expect(readThemeAccentFromConfig({ ui: { accent: 'emerald' } })).toBe('emerald');
    expect(readThemeAccentFromConfig({ appearance: { accent: 'purple' } })).toBe('purple');
    expect(readThemeAccentFromConfig({ settings: { accent: 'blue' } })).toBe('blue');
    expect(readThemeAccentFromConfig({ identity: { accent: 'orange' } })).toBe('orange');
    expect(readThemeAccentFromConfig({ identity: { theme: 'rose' } })).toBe('rose');
  });

  test('normalizes case and whitespace', () => {
    expect(readThemeAccentFromConfig({ theme: '  ROSE  ' })).toBe('rose');
    expect(readThemeAccentFromConfig({ ui: { accent: ' Emerald ' } })).toBe('emerald');
  });

  test('flat keys win over nested ones', () => {
    expect(readThemeAccentFromConfig({ themeAccent: 'rose', ui: { accent: 'teal' } })).toBe('rose');
    expect(readThemeAccentFromConfig({ theme: 'dark', ui: { accent: 'teal' } })).toBe('teal');
  });

  test('rejects garbage shapes without throwing', () => {
    expect(readThemeAccentFromConfig(undefined)).toBeUndefined();
    expect(readThemeAccentFromConfig({})).toBeUndefined();
    expect(readThemeAccentFromConfig({ theme: 'dark' })).toBeUndefined();
    expect(readThemeAccentFromConfig({ theme: 42 } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(readThemeAccentFromConfig({ theme: null } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(readThemeAccentFromConfig({ ui: ['rose'] } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(readThemeAccentFromConfig({ ui: { accent: '' } })).toBeUndefined();
    expect(readThemeAccentFromConfig({ ui: { accent: '   ' } })).toBeUndefined();
    expect(readThemeAccentFromConfig({ ui: 'rose' } as unknown as Record<string, unknown>)).toBeUndefined();
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

describe('readThemeAccentFromConfig fuzz', () => {
  test('never throws and only ever returns a valid accent (seed 0xacc)', () => {
    const rand = mulberry32(0xacc);
    const keys = ['theme', 'themeAccent', 'accent', 'ui', 'appearance', 'settings', 'identity', 'x'];
    const leaves: unknown[] = [
      'rose',
      'ROSE ',
      'not-a-color',
      '',
      0,
      42,
      null,
      undefined,
      true,
      ['rose'],
      { accent: 'teal' },
      { theme: 5 },
      Symbol('s'),
      () => 'rose',
    ];
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

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

describe('themeConfigPayload', () => {
  test('mirrors the accent into every config alias', () => {
    expect(themeConfigPayload('teal')).toEqual({
      theme: 'teal',
      themeAccent: 'teal',
      theme_accent: 'teal',
      ui_accent: 'teal',
    });
  });
});

describe('useUIStore actions', () => {
  test('setAccent updates state', () => {
    useUIStore.getState().setAccent('rose');
    expect(useUIStore.getState().accent).toBe('rose');
  });

  test('setLoading tracks independent keys', () => {
    useUIStore.getState().setLoading('agents', true);
    useUIStore.getState().setLoading('chat', true);
    useUIStore.getState().setLoading('agents', false);
    expect(useUIStore.getState().loading).toEqual({ agents: false, chat: true });
  });

  test('addToast and removeToast manage the toast list', () => {
    useUIStore.getState().addToast('success', 'saved');
    useUIStore.getState().addToast('error', 'broke');
    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(2);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].message).toBe('saved');
    expect(toasts[0].id).not.toBe(toasts[1].id);

    useUIStore.getState().removeToast(toasts[0].id);
    expect(useUIStore.getState().toasts.map((t) => t.message)).toEqual(['broke']);
  });

  test('openModal and closeModal manage modal state and data', () => {
    useUIStore.getState().openModal('settings', { tab: 'theme' });
    expect(useUIStore.getState().activeModal).toBe('settings');
    expect(useUIStore.getState().modalData).toEqual({ tab: 'theme' });

    useUIStore.getState().closeModal();
    expect(useUIStore.getState().activeModal).toBeNull();
    expect(useUIStore.getState().modalData).toBeNull();
  });

  test('toggleSidebar flips the flag', () => {
    expect(useUIStore.getState().sidebarOpen).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });
});

interface PersistenceReport {
  persistedAfterSet: { state: Record<string, unknown> } | null;
  rehydratedAccent: string;
  garbageRehydrateThrew: boolean;
  accentAfterGarbage: string;
  hasPersistApi: boolean;
}

// zustand's persist middleware binds localStorage when the module first
// evaluates, so persistence runs in a child process where a shim module
// installs an in-memory localStorage before uiStore loads.
function runPersistenceWorker(): PersistenceReport {
  const dir = mkdtempSync(join(tmpdir(), 'cybara-uistore-'));
  try {
    writeFileSync(
      join(dir, 'shim.ts'),
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
      'utf-8'
    );
    writeFileSync(
      join(dir, 'worker.ts'),
      `
import "./shim.ts";
import { useUIStore } from "${STORE_PATH}";

const ls = (globalThis as { localStorage: Storage }).localStorage;

useUIStore.getState().setAccent("amber");
useUIStore.getState().setLoading("x", true);
useUIStore.getState().openModal("m");
const raw = ls.getItem("cybara-ui-settings");
const persistedAfterSet = raw ? JSON.parse(raw) : null;

ls.setItem("cybara-ui-settings", JSON.stringify({ state: { accent: "purple" }, version: 0 }));
await useUIStore.persist.rehydrate();
const rehydratedAccent = useUIStore.getState().accent;

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
      garbageRehydrateThrew,
      accentAfterGarbage: useUIStore.getState().accent,
      hasPersistApi: typeof useUIStore.persist?.rehydrate === "function",
    })
);
`,
      'utf-8'
    );
    const result = Bun.spawnSync([process.execPath, 'run', join(dir, 'worker.ts')], {
      cwd: dirname(STORE_PATH),
    });
    const stdout = result.stdout.toString();
    if (result.exitCode !== 0) {
      throw new Error(`uiStore worker failed: ${result.stderr.toString()}\n${stdout}`);
    }
    const line = stdout.split('\n').find((l) => l.startsWith('@@REPORT@@'));
    if (!line) throw new Error(`no report in worker output:\n${stdout}`);
    return JSON.parse(line.slice('@@REPORT@@'.length)) as PersistenceReport;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('useUIStore persistence', () => {
  const report = runPersistenceWorker();

  test('exposes the persist API when storage is available at load time', () => {
    expect(report.hasPersistApi).toBe(true);
  });

  test('persists only the accent', () => {
    expect(report.persistedAfterSet).not.toBeNull();
    expect(report.persistedAfterSet?.state).toEqual({ accent: 'amber' });
  });

  test('rehydrates the accent from storage', () => {
    expect(report.rehydratedAccent).toBe('purple');
  });

  test('rehydrating garbage storage does not throw and keeps a valid accent', () => {
    expect(report.garbageRehydrateThrew).toBe(false);
    expect(themeAccentKeys).toContain(report.accentAfterGarbage);
    expect(typeof initialState.setAccent).toBe('function');
  });
});
