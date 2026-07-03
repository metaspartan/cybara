import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");
const screen = read("screens/DashboardScreen.tsx") + read("screens/dashboardSettingsPanels.tsx");
// The shared settings-control components were extracted out of the screen.
const controls = read("screens/dashboardControls.tsx");

describe("mobile: native dropdown selector", () => {
  test("SettingSelector supports a native menu variant", () => {
    expect(controls).toContain('variant?: "chips" | "segmented" | "menu"');
    // iOS uses the native action sheet; Android uses a modal sheet.
    expect(controls).toContain("ActionSheetIOS.showActionSheetWithOptions");
    expect(controls).toContain("menuSheet");
  });

  test("multi-option pickers (Type, Provider, Recall) use the menu variant", () => {
    // Type + Provider in the agent form
    expect(screen).toMatch(/label="Type"\s*\n\s*variant="menu"/);
    expect(screen).toMatch(/label="Provider"\s*\n\s*variant="menu"/);
    // No multi-option picker is left rendering as a wall of chips
    expect(screen).not.toContain('variant="chips"');
  });

  test("in-card settings choices are menu rows, not boxed segmented controls", () => {
    // Tool approvals + Reasoning effort sat inside the Platform controls card as
    // segmented strips (the boxed look); they are dropdown rows now.
    const toolApprovals = screen.slice(screen.indexOf('label="Tool approvals"'));
    expect(toolApprovals.slice(0, 900)).toContain('variant="menu"');
    const reasoning = screen.slice(screen.indexOf('label="Reasoning effort"'));
    expect(reasoning.slice(0, 900)).toContain('variant="menu"');
  });
});

describe("mobile: settings is a bottom tab", () => {
  test("no redundant header settings gear; settings is a first-class tab", () => {
    // The old global "open settings" header gear was removed in favor of a tab.
    expect(screen).not.toContain('accessibilityLabel="Open settings"');
    expect(screen).not.toContain('!detailRoute && activeTab !== "settings" ?');
    expect(screen).toContain("settings: Settings");
  });
});
