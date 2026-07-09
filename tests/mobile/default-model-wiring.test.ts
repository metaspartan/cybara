import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");
const readDashboardModules = () =>
  read("screens/DashboardScreen.tsx") +
  read("screens/dashboardDetailPanels.tsx") +
  read("screens/dashboardSettingsPanels.tsx") +
  read("screens/dashboardSurfaceData.ts");

describe("mobile: model config lives in agent details, not global settings", () => {
  const screen = readDashboardModules();

  test("global settings do not carry a default-model field or quick pick", () => {
    expect(screen).not.toContain('label="Default model"');
    expect(screen).not.toContain('label="Quick pick"');
    expect(screen).not.toContain("defaultModelDraft");
  });

  test("model is edited in the agent details form", () => {
    expect(screen).toContain("setModel");
  });
});

describe("mobile: memory method toggle", () => {
  const screen = readDashboardModules();

  test("recall-method selector lives on the Memory sub-page, not the settings tab", () => {
    // Recall now belongs to the Memory detail page (MemoryRecallCard),
    // rendered when the memory surface opens.
    expect(screen).toContain("function MemoryRecallCard(");
    expect(screen).toContain('label="Recall method"');
    expect(screen).toContain('surface === "memory" ? (');
    expect(screen).toContain("<MemoryRecallCard");
    expect(screen).toContain(
      "workspace_indexer: { ...workspaceIndexer, embeddingProvider: value }"
    );
    for (const provider of [
      "auto",
      "local",
      "transformers_js",
      "openai",
      "voyage",
      "gemini",
      "ollama",
    ]) {
      expect(screen).toContain(`value: "${provider}"`);
    }
    // Memory settings are a drill-in detail page (MemorySettingsPanel), not an
    // inline section on the root settings tab.
    expect(screen).toContain("onPress={openMemory}");
    expect(screen).not.toContain('label="Memory method"');
  });
});

describe("mobile: primary navigation", () => {
  const screen = readDashboardModules();

  test("Tasks and Settings are bottom tabs (no header gear)", () => {
    expect(screen).toContain("tasks: CalendarCheck");
    expect(screen).toContain('activeTab === "tasks"');
    expect(screen).toContain("<TasksPanel");
    // Settings is a first-class tab now; the redundant header gear is gone.
    expect(screen).toContain("settings: Settings");
    expect(screen).not.toContain('accessibilityLabel="Open settings"');
  });

  test("Home grid no longer duplicates Chats or Tasks (both are tabs)", () => {
    const modulesBlock = screen.slice(
      screen.indexOf("const modules: ModuleCard[]"),
      screen.indexOf("const modules: ModuleCard[]") + 2000
    );
    expect(modulesBlock).not.toContain('label: "Chats"');
    expect(modulesBlock).not.toContain('label: "Tasks"');
  });
});

describe("mobile: system prompt sub-page (web parity)", () => {
  const screen = readDashboardModules();

  test("identity + instructions live on a dedicated System Prompt page reached from settings", () => {
    // Dedicated sub-page component + settings nav row + route
    expect(screen).toContain("function SystemPromptPanel(");
    expect(screen).toContain("<SystemPromptPanel");
    expect(screen).toContain('kind: "systemPrompt"');
    expect(screen).toContain("openSystemPrompt");
    expect(screen).toContain("<Text style={styles.listTitle}>System Prompt</Text>");
    // and it is no longer a section on the settings tab
    expect(screen).not.toContain('title="Assistant identity"');
    expect(screen).not.toContain('title="Agent prompt features"');
  });

  test("the sub-page persists identity + instructions via updateSystemPrompt", () => {
    expect(screen).toContain('label="Name"');
    expect(screen).toContain('label="Custom instructions"');
    expect(screen).toContain("saveSystemPromptConfig");
    expect(screen).toContain("api.updateSystemPrompt");
    expect(screen).toContain("customPrompt: customPromptDraft");
  });
});

describe("mobile: model router sub-page", () => {
  const screen = readDashboardModules();

  test("router config lives on its own Model Router page reached from settings", () => {
    expect(screen).toContain("function ModelRouterPanel(");
    expect(screen).toContain("<ModelRouterPanel");
    expect(screen).toContain('kind: "modelRouter"');
    expect(screen).toContain("openModelRouter");
    expect(screen).toContain("<Text style={styles.listTitle}>Model Router</Text>");
    // no longer an inline section on the settings tab
    expect(screen).not.toContain('title="Model router"');
  });

  test("the router page keeps strategy, fallback, and spend controls", () => {
    const panel = screen.slice(screen.indexOf("function ModelRouterPanel("));
    expect(panel).toContain('label="Selection strategy"');
    expect(panel).toContain('label="Fallback providers"');
    expect(panel.slice(0, 10000)).toContain("api.updateRouterConfig");
    // MoA-specific controls surface when that strategy is picked
    expect(panel).toContain('label="Aggregator agent"');
    expect(panel).toContain('label="Monitor coding plans"');
    expect(panel).toContain('label="Block exhausted plans"');
    expect(panel).toContain('label="Coding plan"');
  });

  test("mixture-of-agents is a selectable strategy end to end", () => {
    const lib = read("lib/dashboard.ts");
    expect(lib).toContain('{ label: "Mixture of Agents", value: "mixture_of_agents" }');
    expect(screen).toContain('routerStrategy === "mixture_of_agents"');
  });
});

describe("mobile HIG: safe-area inset on the tab bar", () => {
  const screen = readDashboardModules();

  test("floats the tab bar above the home indicator using safe-area insets", () => {
    expect(screen).toContain("useSafeAreaInsets");
    expect(screen).toContain("insets.bottom + MOBILE_NAV_CHROME.floatingMargin");
  });
});
