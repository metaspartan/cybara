import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readScreen = (name: string): string =>
  readFileSync(new URL(`../../apps/mobile/src/screens/${name}`, import.meta.url), "utf8");

describe("mobile settings module organization", () => {
  test("keeps settings panel modules below 2000 lines", () => {
    const source = readScreen("dashboardSettingsPanels.tsx");
    const advanced = readScreen("dashboardAdvancedSettingsPanels.tsx");
    expect(source.split("\n").length).toBeLessThanOrEqual(2000);
    expect(advanced.split("\n").length).toBeLessThanOrEqual(2000);
  });

  test("keeps independent settings features in dedicated modules", () => {
    expect(readScreen("dashboardModelRouterPanel.tsx")).toContain(
      "export function ModelRouterPanel"
    );
    expect(readScreen("dashboardSpeechSettingsPanel.tsx")).toContain(
      "export function SpeechSettingsPanel"
    );
    expect(readScreen("dashboardJourneyPanel.tsx")).toContain("export function JourneyPanel");
    expect(readScreen("dashboardProviderPlanUsage.tsx")).toContain(
      "export function ProviderPlanUsageGrid"
    );
    expect(readScreen("dashboardAgentSettingsPanel.tsx")).toContain(
      "export function AgentSettingsPanel"
    );
    expect(readScreen("dashboardAdvancedSettingsPanels.tsx")).toContain(
      "export function MigrationSettingsPanel"
    );
    expect(readScreen("dashboardAdvancedSettingsPanels.tsx")).toContain(
      "export function MemorySettingsPanel"
    );
    expect(readScreen("dashboardAdvancedSettingsPanels.tsx")).toContain(
      "export function SystemPromptPanel"
    );
  });

  test("does not duplicate extracted feature implementations in the shared module", () => {
    const source = readScreen("dashboardSettingsPanels.tsx");
    expect(source).not.toContain("export function ModelRouterPanel");
    expect(source).not.toContain("export function SpeechSettingsPanel");
    expect(source).not.toContain("export function JourneyPanel");
    expect(source).not.toContain("export function AgentSettingsPanel");
    expect(source).not.toContain("export function MigrationSettingsPanel");
    expect(source).not.toContain("export function MemorySettingsPanel");
    expect(source).not.toContain("export function SystemPromptPanel");
  });

  test("keeps migration source detection outside state updater callbacks", () => {
    const source = readScreen("dashboardAdvancedSettingsPanels.tsx");
    expect(source).toContain("sourcePathRef.current = value");
    expect(source).toContain("if (detected && !sourcePathRef.current.trim())");
    expect(source).not.toContain("setSourcePath((current)");
  });
});
