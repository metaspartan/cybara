import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");
const screen = read("screens/DashboardScreen.tsx");

describe("mobile: native dropdown selector", () => {
  test("SettingSelector supports a native menu variant", () => {
    expect(screen).toContain('variant?: "chips" | "segmented" | "menu"');
    // iOS uses the native action sheet; Android uses a modal sheet.
    expect(screen).toContain("ActionSheetIOS.showActionSheetWithOptions");
    expect(screen).toContain("menuSheet");
  });

  test("multi-option pickers (Type, Provider, Recall) use the menu variant", () => {
    // Type + Provider in the agent form
    expect(screen).toMatch(/label="Type"\s*\n\s*variant="menu"/);
    expect(screen).toMatch(/label="Provider"\s*\n\s*variant="menu"/);
    // No multi-option picker is left rendering as a wall of chips
    expect(screen).not.toContain('variant="chips"');
  });
});

describe("mobile: settings gear", () => {
  test("gear shows on every tab except the settings page itself", () => {
    expect(screen).toContain('!detailRoute && activeTab !== "settings" ?');
    // metrics is no longer excluded
    expect(screen).not.toContain('activeTab !== "metrics" && activeTab !== "settings"');
  });
});
