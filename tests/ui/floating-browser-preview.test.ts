import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clampFloatingBrowserPreviewRect,
  defaultFloatingBrowserPreviewRect,
  FLOATING_COMPUTER_PREVIEW_STORAGE_KEY,
  FLOATING_PREVIEW_MINIMIZED_SIZE,
  isFloatingBrowserPreviewClick,
  parseFloatingBrowserPreviewRect,
  persistFloatingPreviewHidden,
  persistFloatingPreviewMinimized,
  readFloatingPreviewHidden,
  readFloatingPreviewMinimized,
  shouldShowFloatingBrowserPreview,
} from "../../ui/src/pages/chat/floatingBrowserPreviewModel";

function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

describe("floating browser preview", () => {
  beforeEach(() => {
    globalThis.window = {
      localStorage: makeLocalStorage(),
    } as unknown as Window & typeof globalThis;
    globalThis.localStorage = globalThis.window.localStorage;
  });

  afterEach(() => {
    globalThis.window = originalWindow as unknown as Window & typeof globalThis;
    globalThis.localStorage = originalLocalStorage;
  });

  test("defaults above the composer and stays inside the chat surface", () => {
    expect(defaultFloatingBrowserPreviewRect({ width: 1_000, height: 800 }, 120)).toEqual({
      x: 728,
      y: 488,
      width: 260,
      height: 180,
    });
    expect(defaultFloatingBrowserPreviewRect({ width: 1_000, height: 800 }, 120, "left")).toEqual({
      x: 12,
      y: 488,
      width: 260,
      height: 180,
    });
    expect(
      clampFloatingBrowserPreviewRect(
        { width: 390, height: 700 },
        { x: -100, y: 900, width: 900, height: 900 },
        100
      )
    ).toEqual({ x: 12, y: 408, width: 260, height: 180 });
  });

  test("parses only finite persisted geometry", () => {
    expect(parseFloatingBrowserPreviewRect('{"x":20,"y":30,"width":500,"height":320}')).toEqual({
      x: 20,
      y: 30,
      width: 500,
      height: 320,
    });
    expect(parseFloatingBrowserPreviewRect('{"x":20,"y":30,"width":0,"height":320}')).toBeNull();
    expect(parseFloatingBrowserPreviewRect("not-json")).toBeNull();
  });

  test("appears whenever browser work is available outside the browser panel", () => {
    const base = {
      activeWorkspaceKind: null,
      artifactOpen: false,
      available: true,
      sessionId: "session-1",
      workspacePanelOpen: false,
    };
    expect(shouldShowFloatingBrowserPreview(base)).toBe(true);
    expect(
      shouldShowFloatingBrowserPreview({
        ...base,
        activeWorkspaceKind: "terminal",
        workspacePanelOpen: true,
      })
    ).toBe(true);
    expect(
      shouldShowFloatingBrowserPreview({
        ...base,
        activeWorkspaceKind: "browser",
        workspacePanelOpen: true,
      })
    ).toBe(false);
    expect(shouldShowFloatingBrowserPreview({ ...base, sessionId: null })).toBe(false);
    expect(
      shouldShowFloatingBrowserPreview({
        ...base,
        activeWorkspaceKind: "computer",
        previewKind: "computer",
        workspacePanelOpen: true,
      })
    ).toBe(false);
  });

  test("opens on a click while preserving drag gestures", () => {
    expect(isFloatingBrowserPreviewClick(0, 0)).toBe(true);
    expect(isFloatingBrowserPreviewClick(4, 4)).toBe(true);
    expect(isFloatingBrowserPreviewClick(7, 0)).toBe(false);
    expect(isFloatingBrowserPreviewClick(24, 18)).toBe(false);
  });

  test("keeps a minimized preview as a small draggable puck inside the surface", () => {
    const container = { width: 1200, height: 800 };
    const minimized = {
      width: FLOATING_PREVIEW_MINIMIZED_SIZE,
      height: FLOATING_PREVIEW_MINIMIZED_SIZE,
    };
    const rect = defaultFloatingBrowserPreviewRect(container, 100, "right", minimized);
    expect(rect.width).toBe(FLOATING_PREVIEW_MINIMIZED_SIZE);
    expect(rect.height).toBe(FLOATING_PREVIEW_MINIMIZED_SIZE);
    expect(rect.x + rect.width).toBeLessThanOrEqual(container.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(container.height - 100);

    const dragged = clampFloatingBrowserPreviewRect(
      container,
      { ...rect, x: -400, y: -400 },
      100,
      minimized
    );
    expect(dragged.width).toBe(FLOATING_PREVIEW_MINIMIZED_SIZE);
    expect(dragged.x).toBeGreaterThan(0);
    expect(dragged.y).toBeGreaterThan(0);
  });

  test("persists and reads the minimized flag per storage key", () => {
    expect(readFloatingPreviewMinimized(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY)).toBe(false);
    persistFloatingPreviewMinimized(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY, true);
    expect(readFloatingPreviewMinimized(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY)).toBe(true);
    expect(readFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY)).toBe(false);
    persistFloatingPreviewMinimized(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY, false);
    expect(readFloatingPreviewMinimized(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY)).toBe(false);
  });

  test("persists and reads the hidden flag per storage key", () => {
    expect(readFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY)).toBe(false);
    persistFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY, true);
    expect(readFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY)).toBe(true);
    persistFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY, false);
    expect(readFloatingPreviewHidden(FLOATING_COMPUTER_PREVIEW_STORAGE_KEY)).toBe(false);
  });
});
