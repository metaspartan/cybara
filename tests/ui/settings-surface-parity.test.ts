import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const webSettings = readFileSync(join(root, "ui/src/pages/Settings.tsx"), "utf8");
const webSafety = readFileSync(join(root, "ui/src/pages/settings/FeatureSettings.tsx"), "utf8");
const webPolicy = readFileSync(
  join(root, "ui/src/pages/settings/WebToolPolicySettings.tsx"),
  "utf8"
);
const mobileSettings = readFileSync(
  join(root, "apps/mobile/src/screens/dashboardDetailPanels.tsx"),
  "utf8"
);
const mobilePolicy = readFileSync(
  join(root, "apps/mobile/src/screens/dashboardWebPolicyPanel.tsx"),
  "utf8"
);
const nativeSettings = readFileSync(
  join(root, "apps/macos/Cybara/Sources/Cybara/NativeSettingsScreen.swift"),
  "utf8"
);

describe("settings surface parity", () => {
  test("web safety uses switches and exposes the web access policy", () => {
    expect(webSettings).toContain("<WebToolPolicySettings />");
    expect(webSafety).toContain("<Switch");
    expect(webSafety).not.toContain('type="checkbox"');
    expect(webPolicy).toContain("web_tool_url_policy");
    expect(webPolicy).toContain("fetch_allowlist");
    expect(webPolicy).toContain("search_result_allowlist");
  });

  test("mobile safety exposes ACP and web policy using native switches", () => {
    expect(mobileSettings).toContain('label="ACP server"');
    expect(mobileSettings).toContain("<MobileWebPolicyPanel");
    expect(mobilePolicy).toContain("<SettingToggle");
    expect(mobilePolicy).toContain("web_tool_url_policy");
    expect(mobileSettings).not.toContain('type="checkbox"');
  });

  test("native macOS keeps learning under AI and network controls under safety", () => {
    expect(nativeSettings).toContain('Text("Agent Learning")');
    expect(nativeSettings).toContain('toggleRow("ACP Server"');
    expect(nativeSettings).toContain('Text("Web Access Policy")');
    expect(nativeSettings).toContain('"web_tool_url_policy"');
    expect(nativeSettings).toContain("isOn: $webPolicyEnabled");
  });
});
