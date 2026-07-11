import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readScreen = (name: string): string =>
  readFileSync(new URL(`../../apps/mobile/src/screens/${name}`, import.meta.url), "utf8");

describe("mobile settings module organization", () => {
  test("keeps the shared settings panel module below 3000 lines", () => {
    const source = readScreen("dashboardSettingsPanels.tsx");
    expect(source.split("\n").length).toBeLessThanOrEqual(3000);
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
  });

  test("does not duplicate extracted feature implementations in the shared module", () => {
    const source = readScreen("dashboardSettingsPanels.tsx");
    expect(source).not.toContain("export function ModelRouterPanel");
    expect(source).not.toContain("export function SpeechSettingsPanel");
    expect(source).not.toContain("export function JourneyPanel");
  });
});
