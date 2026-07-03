import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getDesktopHostRuntime,
  isDesktopHostRuntime,
  isTauriDesktopRuntime,
  isCybaraNativeRuntime,
  isDesktopUpdaterSupported,
  getDesktopRuntimeLabel,
} from "./desktopHost";

const g = globalThis as { window?: unknown };
let hadWindow: boolean;
let originalWindow: unknown;

beforeEach(() => {
  hadWindow = "window" in g;
  originalWindow = g.window;
});

afterEach(() => {
  if (hadWindow) {
    g.window = originalWindow;
  } else {
    delete g.window;
  }
});

function setWindow(shape: Record<string, unknown> | undefined) {
  if (shape === undefined) {
    delete g.window;
  } else {
    g.window = shape;
  }
}

describe("getDesktopHostRuntime", () => {
  test("no window object defaults to null (web)", () => {
    setWindow(undefined);
    expect(getDesktopHostRuntime()).toBe(null);
    expect(isDesktopHostRuntime()).toBe(false);
  });

  test("bare window with no bridge fields is web", () => {
    setWindow({});
    expect(getDesktopHostRuntime()).toBe(null);
  });

  test("detects Tauri via __TAURI_INTERNALS__", () => {
    setWindow({ __TAURI_INTERNALS__: {} });
    expect(isTauriDesktopRuntime()).toBe(true);
    expect(getDesktopHostRuntime()).toBe("tauri");
  });

  test("detects Tauri via __TAURI__", () => {
    setWindow({ __TAURI__: {} });
    expect(getDesktopHostRuntime()).toBe("tauri");
  });

  test("detects cybara-native bridge", () => {
    setWindow({ __CYBARA_NATIVE__: { runtime: "cybara-native" } });
    expect(isCybaraNativeRuntime()).toBe(true);
    expect(getDesktopHostRuntime()).toBe("cybara-native");
  });

  test("cybara bridge with wrong runtime value is not detected", () => {
    setWindow({ __CYBARA_NATIVE__: { runtime: "something-else" } });
    expect(isCybaraNativeRuntime()).toBe(false);
    expect(getDesktopHostRuntime()).toBe(null);
  });

  test("tauri wins over cybara-native when both present", () => {
    setWindow({ __TAURI__: {}, __CYBARA_NATIVE__: { runtime: "cybara-native" } });
    expect(getDesktopHostRuntime()).toBe("tauri");
  });
});

describe("isDesktopUpdaterSupported", () => {
  test("only tauri supports the desktop updater", () => {
    setWindow({ __TAURI__: {} });
    expect(isDesktopUpdaterSupported()).toBe(true);

    setWindow({ __CYBARA_NATIVE__: { runtime: "cybara-native" } });
    expect(isDesktopUpdaterSupported()).toBe(false);

    setWindow({});
    expect(isDesktopUpdaterSupported()).toBe(false);
  });
});

describe("getDesktopRuntimeLabel", () => {
  test("maps runtime to human label", () => {
    expect(getDesktopRuntimeLabel("tauri")).toBe("Tauri Desktop");
    expect(getDesktopRuntimeLabel("cybara-native")).toBe("Cybara macOS App");
    expect(getDesktopRuntimeLabel(null)).toBe("Web");
  });

  test("defaults to the current runtime when no arg passed", () => {
    setWindow({});
    expect(getDesktopRuntimeLabel()).toBe("Web");
  });
});
