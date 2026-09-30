import { describe, expect, test } from "bun:test";
import {
  frontmostWindow,
  orderWindowsFrontmostFirst,
  parseDriverWindows,
} from "../../src/core/computer-use-window-order";

describe("driver window ordering", () => {
  test("keeps the highest z-index first, matching the driver stacking contract", () => {
    const ordered = orderWindowsFrontmostFirst([
      { appName: "Backmost", pid: 1, zIndex: 0 },
      { appName: "Frontmost", pid: 2, zIndex: 12 },
      { appName: "Middle", pid: 3, zIndex: 5 },
    ]);
    expect(ordered.map((window) => window.appName)).toEqual(["Frontmost", "Middle", "Backmost"]);
  });

  test("never treats a null z-index as zero", () => {
    const windows = parseDriverWindows([
      { app_name: "Unknown", pid: 10, z_index: null },
      { app_name: "Behind", pid: 11, z_index: 0 },
      { app_name: "Ahead", pid: 12, z_index: 1 },
    ]);
    expect(windows[0]?.zIndex).toBeNull();
    expect(frontmostWindow(windows)?.appName).toBe("Ahead");
  });

  test("a null z-index does not outrank a known stacking order", () => {
    const ordered = orderWindowsFrontmostFirst([
      { appName: "Unknown", pid: 1, zIndex: null },
      { appName: "Known", pid: 2, zIndex: -4 },
    ]);
    expect(ordered[0]?.appName).toBe("Known");
  });

  test("falls back to arrival order when every z-index is unknown", () => {
    const ordered = orderWindowsFrontmostFirst([
      { appName: "First", pid: 1, zIndex: null },
      { appName: "Second", pid: 2, zIndex: null },
    ]);
    expect(ordered.map((window) => window.appName)).toEqual(["First", "Second"]);
  });

  test("parses the driver record shape and drops records without a pid", () => {
    const windows = parseDriverWindows([
      { app_name: "Notes", pid: 42, window_id: 7, z_index: 3 },
      { app_name: "Broken" },
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ appName: "Notes", pid: 42, windowId: 7, zIndex: 3 });
  });
});
