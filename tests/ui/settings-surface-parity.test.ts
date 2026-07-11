import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const webSettings = readFileSync(join(root, "ui/src/pages/Settings.tsx"), "utf8");
const webApi = readFileSync(join(root, "ui/src/lib/api.ts"), "utf8");
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
const mobileComputerUse = readFileSync(
  join(root, "apps/mobile/src/screens/dashboardComputerUsePanel.tsx"),
  "utf8"
);
const mobileApi = readFileSync(join(root, "apps/mobile/src/lib/api.ts"), "utf8");
const nativeSettings = readFileSync(
  join(root, "apps/macos/Cybara/Sources/Cybara/NativeSettingsScreen.swift"),
  "utf8"
);
const nativeClient = readFileSync(
  join(root, "apps/macos/Cybara/Sources/Cybara/GatewayClient.swift"),
  "utf8"
);
const nativeConfigScreens = readFileSync(
  join(root, "apps/macos/Cybara/Sources/Cybara/NativeConfigScreens.swift"),
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

  test("mobile safety exposes computer-use diagnostics and driver configuration", () => {
    expect(mobileSettings).toContain("<MobileComputerUsePanel");
    expect(mobileComputerUse).toContain("api.computerUseStatus()");
    expect(mobileComputerUse).toContain("api.grantComputerUsePermissions()");
    expect(mobileComputerUse).toContain("computer_use: { driverCommand:");
    expect(mobileApi).toContain('"/api/computer-use/status"');
    expect(mobileApi).toContain('"/api/computer-use/permissions/grant"');
  });

  test("native macOS keeps chat behavior under AI and network controls under safety", () => {
    expect(nativeSettings).toContain('Text("Chat and Agent Behavior")');
    expect(nativeSettings).toContain('"Queue / Steer follow-ups"');
    expect(nativeSettings).toContain('"follow_up_behavior_enabled"');
    expect(nativeSettings).toContain('"Self-improving skills"');
    expect(nativeSettings).toContain('toggleRow("ACP Server"');
    expect(nativeSettings).toContain('Text("Web Access Policy")');
    expect(nativeSettings).toContain('"web_tool_url_policy"');
    expect(nativeSettings).toContain("isOn: $webPolicyEnabled");
    expect(nativeSettings).toContain('Text("Computer Use")');
    expect(nativeSettings).toContain('["computer_use": ["driverCommand":');
    expect(nativeClient).toContain('get("api/computer-use/status"');
    expect(nativeClient).toContain('"api/computer-use/permissions/grant"');
    expect(nativeClient).toContain('method: "POST"');
  });

  test("wallet seed reveal requires fresh verification on web and native macOS", () => {
    expect(webSettings).toContain("Reveal Seed Phrase");
    expect(webSettings).toContain('seedConfirmText.trim() !== "REVEAL"');
    expect(webSettings).toContain('walletApi.revealSeed(seedPassword, "REVEAL")');
    expect(webApi).toContain('"/wallet/seed"');
    expect(nativeConfigScreens).toContain('Text("Recovery Phrase")');
    expect(nativeConfigScreens).toContain('seedConfirmation == "REVEAL"');
    expect(nativeClient).toContain('request("api/wallet/seed", method: "POST"');
  });
});
