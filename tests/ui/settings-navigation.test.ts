import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSettingsSectionId,
  settingsSectionGroups,
  settingsSections,
} from "../../ui/src/lib/settingsNavigation";

const ROOT_DIR = join(import.meta.dir, "..", "..");
const settingsSource = readFileSync(join(ROOT_DIR, "ui", "src", "pages", "Settings.tsx"), "utf8");
const navigationSource = readFileSync(
  join(ROOT_DIR, "ui", "src", "components", "settings", "SettingsNavigation.tsx"),
  "utf8"
);

describe("web settings navigation", () => {
  test("uses the shared settings information architecture", () => {
    expect(settingsSectionGroups.map((group) => group.labelKey)).toEqual([
      "settings.core",
      "settings.capabilities",
      "settings.security",
      "nav.system",
    ]);
    expect(settingsSections.map((section) => section.labelKey)).toEqual([
      "settings.general",
      "settings.gateway",
      "settings.ai",
      "nav.memory",
      "settings.voice",
      "nav.wallet",
      "settings.safety",
      "settings.migration",
      "nav.system",
    ]);
    expect(settingsSections.map((section) => section.id)).toEqual([
      "general",
      "gateway",
      "ai",
      "memory",
      "voice",
      "wallet",
      "safety",
      "migration",
      "system",
    ]);
  });

  test("preserves old settings deep links through canonical section aliases", () => {
    expect(resolveSettingsSectionId("auth")).toBe("gateway");
    expect(resolveSettingsSectionId("desktop")).toBe("safety");
    expect(resolveSettingsSectionId("ai-memory")).toBe("memory");
    expect(resolveSettingsSectionId("gateway")).toBe("gateway");
    expect(resolveSettingsSectionId("unknown")).toBeNull();
  });

  test("routes high-impact settings into the matching grouped sections", () => {
    expect(settingsSource).toContain("<SettingsNavigation activeSection={activeSection}");
    expect(navigationSource).toContain('aria-label="Settings sections"');
    expect(settingsSource).toContain('title={t("settings.title")}');
    expect(settingsSource).toContain("<Select");
    expect(settingsSource).toContain("languageOptions(locale).map");
    expect(settingsSource).not.toContain(
      '<PageLayout title="Settings" subtitle="Platform configuration and system information">'
    );
    expect(navigationSource).not.toContain("{section.description}");
    expect(navigationSource).toContain('className="block text-sm font-medium leading-5"');
    expect(settingsSource).toContain('activeSection === "gateway"');
    expect(settingsSource).toContain("<GatewayPathSettingsSection");
    expect(settingsSource).toContain("<GatewayAuthSettingsSection");
    expect(settingsSource).toContain("<GatewayControlSection");
    expect(settingsSource).toContain('activeSection === "ai"');
    expect(settingsSource).toContain("<SystemPromptSection");
    expect(settingsSource).toContain("<LlmTimeoutSettingsSection");
    expect(settingsSource).toContain('activeSection === "memory"');
    expect(settingsSource).toContain("<MemoryBehaviorSettings");
    expect(settingsSource).toContain('activeSection === "safety"');
    expect(settingsSource).toContain("<FeatureSettings");
    expect(settingsSource).toContain("<SandboxBrowserSettings");
    expect(settingsSource).toContain("<ComputerUseSettings");
  });
});
