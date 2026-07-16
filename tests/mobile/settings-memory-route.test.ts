import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile settings: Memory lives on its own screen", () => {
  const screen =
    read("screens/DashboardScreen.tsx") +
    read("screens/dashboardDetailPanels.tsx") +
    read("screens/dashboardSettingsPanels.tsx") +
    read("screens/dashboardAdvancedSettingsPanels.tsx") +
    read("screens/dashboardSurfaceData.ts");
  const helpers = read("screens/dashboardHelpers.ts");
  const api = read("lib/api.ts");

  test("there is a dedicated MemorySettingsPanel with memory, provider, and indexing sections", () => {
    expect(screen).toContain("function MemorySettingsPanel(");
    expect(screen).toContain('<SettingsSection title="Memory">');
    expect(screen).toContain('<SettingsSection title="Memory provider">');
    expect(screen).toContain('<SettingsSection title="Indexing">');
  });

  test("memory is a drill-in detail route opened from the root settings panel", () => {
    expect(screen).toContain('{ kind: "memory" }');
    expect(screen).toContain("<MemorySettingsPanel");
    expect(screen).toContain("onPress={openMemory}");
    expect(screen).toContain('title: "Memory"');
  });

  test("all external memory providers are selectable with per-provider fields", () => {
    for (const provider of ["supermemory", "mem0", "honcho", "openviking", "hindsight"]) {
      expect(helpers).toContain(`"${provider}"`);
      expect(screen).toContain(`${provider}: [`);
    }
    expect(screen).toContain("saveProvider({ autoRecall: !providerDraft.autoRecall })");
    expect(screen).toContain("saveProvider({ autoCapture: !providerDraft.autoCapture })");
  });

  test("provider connection test hits the gateway test route", () => {
    expect(api).toContain("/api/memory/providers/test");
    expect(screen).toContain("api.testMemoryProvider(");
  });

  test("settings write the same config keys as the web UI", () => {
    expect(screen).toContain("{ memory: next }");
    expect(screen).toContain("{ memory_provider: next }");
    expect(screen).toContain("{ workspace_indexer: next }");
  });
});
