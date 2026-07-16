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
const sidebarSource = readFileSync(
  join(ROOT_DIR, "ui", "src", "components", "layout", "Sidebar.tsx"),
  "utf8"
);

describe("web settings navigation", () => {
  test("uses the shared settings information architecture", () => {
    expect(settingsSectionGroups.map((group) => group.labelKey)).toEqual([
      "settings.core",
      "settings.agentModels",
      "settings.capabilities",
      "settings.security",
      "nav.system",
    ]);
    expect(settingsSections.map((section) => section.labelKey)).toEqual([
      "settings.general",
      "settings.accessibility",
      "settings.gateway",
      "settings.ai",
      "nav.agents",
      "nav.providers",
      "nav.router",
      "nav.channels",
      "nav.mobile",
      "nav.plugins",
      "nav.mcp",
      "nav.skills",
      "nav.tools",
      "nav.memory",
      "settings.lab",
      "settings.voice",
      "nav.wallet",
      "settings.safety",
      "settings.updates",
      "settings.migration",
      "nav.system",
      "nav.logs",
    ]);
    expect(settingsSections.map((section) => section.id)).toEqual([
      "general",
      "accessibility",
      "gateway",
      "ai",
      "agents",
      "providers",
      "router",
      "channels",
      "mobile",
      "plugins",
      "mcp",
      "skills",
      "tools",
      "memory",
      "lab",
      "voice",
      "wallet",
      "safety",
      "updates",
      "migration",
      "system",
      "logs",
    ]);
  });

  test("renders each settings group as an inline divider", () => {
    expect(navigationSource).toContain("h-px min-w-4 flex-1 bg-[var(--surface-border)]");
    expect(navigationSource).toContain("theme-text-subtle");
  });

  test("preserves old settings deep links through canonical section aliases", () => {
    expect(resolveSettingsSectionId("auth")).toBe("gateway");
    expect(resolveSettingsSectionId("desktop")).toBe("safety");
    expect(resolveSettingsSectionId("ai-memory")).toBe("memory");
    expect(resolveSettingsSectionId("gateway")).toBe("gateway");
    expect(resolveSettingsSectionId("unknown")).toBeNull();
  });

  test("derives the active section from the URL without competing local state", () => {
    expect(settingsSource).toContain(
      'const activeSection = resolveSettingsSectionId(sectionParam) ?? "general";'
    );
    expect(settingsSource).not.toContain("setActiveSection");
    expect(sidebarSource).toContain(
      'navigate(section === "general" ? "/settings" : `/settings?section=${section}`);'
    );
  });

  test("routes high-impact settings into the matching grouped sections", () => {
    expect(sidebarSource).toContain("<SettingsNavigation");
    expect(settingsSource).not.toContain("<SettingsNavigation");
    expect(navigationSource).toContain('aria-label="Settings sections"');
    expect(settingsSource).toContain('title={t("settings.title")}');
    expect(settingsSource).toContain("<Select");
    expect(settingsSource).toContain("languageOptions(locale).map");
    expect(settingsSource).not.toContain(
      '<PageLayout title="Settings" subtitle="Platform configuration and system information">'
    );
    expect(navigationSource).not.toContain("{section.description}");
    expect(navigationSource).toContain("block truncate text-[13px] font-medium leading-5");
    expect(settingsSource).toContain('activeSection === "gateway"');
    expect(settingsSource).toContain('activeSection === "accessibility"');
    expect(settingsSource).toContain("<ChatAccessibilitySettings />");
    expect(settingsSource).toContain("<HotkeySettings />");
    expect(settingsSource).toContain("<GatewayPathSettingsSection");
    expect(settingsSource).toContain("<GatewayAuthSettingsSection");
    expect(settingsSource).toContain("<GatewayControlSection");
    expect(settingsSource).toContain('activeSection === "ai"');
    expect(settingsSource).toContain("<SystemPromptSection");
    expect(settingsSource).toContain("<LlmTimeoutSettingsSection");
    expect(settingsSource).toContain('activeSection === "agents"');
    expect(settingsSource).toContain("<AgentsSettings />");
    expect(settingsSource).toContain('activeSection === "providers"');
    expect(settingsSource).toContain("<ProvidersSettings />");
    expect(settingsSource).toContain('activeSection === "router"');
    expect(settingsSource).toContain("<RouterSettingsPanel />");
    expect(settingsSource).toContain('activeSection === "channels"');
    expect(settingsSource).toContain("<ChannelsSettings />");
    expect(settingsSource).toContain('activeSection === "mobile"');
    expect(settingsSource).toContain("<MobileSettings />");
    expect(settingsSource).toContain('activeSection === "plugins"');
    expect(settingsSource).toContain("<PluginsSettings />");
    expect(settingsSource).toContain('activeSection === "mcp"');
    expect(settingsSource).toContain("<MCPSettings />");
    expect(settingsSource).toContain('activeSection === "skills"');
    expect(settingsSource).toContain("<SkillsSettings />");
    expect(settingsSource).toContain('activeSection === "tools"');
    expect(settingsSource).toContain("<ToolsSettings />");
    expect(settingsSource).toContain('activeSection === "memory"');
    expect(settingsSource).toContain("<MemoryBehaviorSettings");
    expect(settingsSource).toContain('activeSection === "safety"');
    expect(settingsSource).toContain("<FeatureSettings");
    expect(settingsSource).toContain("<SandboxBrowserSettings");
    expect(settingsSource).toContain("<ComputerUseSettings");
    expect(settingsSource).toContain('activeSection === "logs"');
    expect(settingsSource).toContain("<LogsSettings />");
    expect(settingsSource).toContain('activeSection === "updates"');
    expect(settingsSource).toContain("<DesktopUpdateSettings");
    expect(settingsSource.indexOf("<DesktopUpdateSettings")).toBeLessThan(
      settingsSource.indexOf('activeSection === "system"')
    );
  });
});
