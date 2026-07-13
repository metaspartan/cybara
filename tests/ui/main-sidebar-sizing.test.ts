import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clampMainSidebarWidth,
  MAIN_SIDEBAR_DEFAULT_WIDTH,
  MAIN_SIDEBAR_MAX_WIDTH,
  MAIN_SIDEBAR_MIN_WIDTH,
  parseMainSidebarWidth,
} from "../../ui/src/components/layout/sidebarSizing";

describe("main sidebar sizing", () => {
  test("uses a compact default and clamps persisted values", () => {
    expect(MAIN_SIDEBAR_DEFAULT_WIDTH).toBe(208);
    expect(parseMainSidebarWidth(null)).toBe(208);
    expect(parseMainSidebarWidth("240")).toBe(240);
    expect(parseMainSidebarWidth("invalid")).toBe(208);
    expect(clampMainSidebarWidth(100)).toBe(MAIN_SIDEBAR_MIN_WIDTH);
    expect(clampMainSidebarWidth(500)).toBe(MAIN_SIDEBAR_MAX_WIDTH);
  });

  test("persists resizing and shares the width with main content", () => {
    const sidebar = readFileSync(
      join(process.cwd(), "ui", "src", "components", "layout", "Sidebar.tsx"),
      "utf8"
    );
    const app = readFileSync(join(process.cwd(), "ui", "src", "App.tsx"), "utf8");

    expect(sidebar).toContain('aria-label="Resize main sidebar"');
    expect(sidebar).toContain("onPointerDown={beginResize}");
    expect(sidebar).toContain("onKeyDown={resizeWithKeyboard}");
    expect(sidebar).toContain("MAIN_SIDEBAR_WIDTH_STORAGE_KEY");
    expect(sidebar).toContain("md:w-[var(--main-sidebar-width)]");
    expect(app).toContain("md:ml-[var(--main-sidebar-width)]");
  });
});
