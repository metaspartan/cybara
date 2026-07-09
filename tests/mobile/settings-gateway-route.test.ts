import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile settings: Gateway runtime controls", () => {
  const screen =
    read("screens/DashboardScreen.tsx") +
    read("screens/dashboardSettingsPanels.tsx") +
    read("screens/dashboardGatewayPanel.tsx");
  const api = read("lib/api.ts");
  const app = read("../App.tsx");

  test("settings exposes gateway restart, auth, key rotation, and recent logs", () => {
    expect(screen).toContain("export function GatewayManagementPanel(");
    expect(screen).toContain("<GatewayManagementPanel");
    expect(screen).toContain('<SettingsSection title="Gateway runtime">');
    expect(screen).toContain('<SettingsSection title="Recent gateway logs">');
    expect(screen).toContain('label="Restart Gateway"');
    expect(screen).toContain('label="Open Logs"');
    expect(screen).toContain('label="Rotate"');
    expect(screen).toContain("Default Workspace");
    expect(screen).toContain("default_workspace_dir: defaultWorkspaceDir.trim()");
    expect(screen).toContain('label="Save Workspace"');
    expect(screen).toContain("Data Directory");
    expect(screen).toContain("cybara_data_dir: cybaraDataDir.trim()");
    expect(screen).toContain('label="Save Data Directory"');
    expect(screen).toContain("cybara_data_dir_restart_required");
    expect(screen).toContain("api.restartGateway()");
    expect(screen).toContain("api.gatewayAuthSettings()");
    expect(screen).toContain("api.rotateGatewayApiKey()");
    expect(screen).toContain("api.updateConfig({");
  });

  test("rotated root keys are adopted by the live client and persisted profile", () => {
    expect(screen).toContain("api.setApiKey(result.apiKey)");
    expect(screen).toContain("await saveProfile(nextProfile)");
    expect(screen).toContain("await onProfileUpdated(nextProfile)");
    expect(app).toContain("const updateProfile = async (nextProfile: GatewayProfile)");
    expect(app).toContain("onProfileUpdated={updateProfile}");
  });

  test("mobile API client matches gateway management routes", () => {
    expect(api).toContain('"/api/system/restart"');
    expect(api).toContain('"/api/auth/settings"');
    expect(api).toContain('"/api/auth/key"');
    expect(api).toContain('"/api/auth/rotate-key"');
    expect(api).toContain("setApiKey(apiKey: string)");
    expect(api).toContain("setGatewayPassword(gatewayPassword?: string)");
    expect(api).toContain('"X-Cybara-Gateway-Password"');
    expect(api).toContain("interface GatewayAuthSettings");
    expect(screen).toContain("Gateway Password");
    expect(screen).toContain("Remote Access");
    expect(screen).toContain("remoteAccessModeOptions");
    expect(screen).toContain("api.updateGatewayAuthSettings({");
    expect(screen).toContain("remoteAccess: {");
    expect(api).toContain("interface GatewayRestartResponse");
    expect(api).toContain("interface GatewayRemoteAccessSettings");
  });
});
