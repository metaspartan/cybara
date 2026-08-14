import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  mobileBackRouteForDetail,
  mobileSettingsTabForSurface,
} from "../../apps/mobile/src/lib/dashboard";

const dashboard = readFileSync(
  new URL("../../apps/mobile/src/screens/DashboardScreen.tsx", import.meta.url),
  "utf8"
);
const settingsPanel = readFileSync(
  new URL("../../apps/mobile/src/screens/dashboardDetailPanels.tsx", import.meta.url),
  "utf8"
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return source.slice(startIndex, endIndex);
}

describe("mobile settings category navigation", () => {
  test("Providers -> provider -> back retains the Providers category", () => {
    expect(mobileSettingsTabForSurface("providers")).toBe("providers");
    expect(mobileBackRouteForDetail({ kind: "item", surface: "providers" })).toEqual({
      kind: "surface",
      surface: "providers",
    });
    expect(dashboard).toContain('useState<MobileSettingsTab>("general")');
    expect(dashboard).toContain('if (activeTab !== "settings") {');
    expect(dashboard).toContain("const settingsTab = mobileSettingsTabForSurface(surface);");
    expect(dashboard).toContain("if (settingsTab) setSelectedSettingsTab(settingsTab);");
    expect(dashboard).toContain("selectedSettingsTab={selectedSettingsTab}");
    expect(dashboard).toContain("onSelectSettingsTab={setSelectedSettingsTab}");
    expect(settingsPanel).not.toContain(
      "const [selectedSettingsTab, setSelectedSettingsTab] = useState"
    );
    expect(settingsPanel).toContain("onSelectSettingsTab(value as MobileSettingsTab)");
  });

  test("AI -> system prompt -> back retains the AI category", () => {
    const openSystemPrompt = sourceBetween(
      dashboard,
      "const openSystemPrompt = () => {",
      "const openSpeech = () => {"
    );

    expect(openSystemPrompt).toContain('setSelectedSettingsTab("ai");');
    expect(openSystemPrompt).toContain('setDetailRoute({ kind: "systemPrompt" });');
    expect(mobileBackRouteForDetail({ kind: "systemPrompt" })).toBeNull();
    expect(settingsPanel).toContain("selectedSettingsTab: MobileSettingsTab;");
  });
});
