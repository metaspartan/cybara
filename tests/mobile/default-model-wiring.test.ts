import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile: model config lives in agent details, not global settings", () => {
  const screen = read("screens/DashboardScreen.tsx");

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
  const screen = read("screens/DashboardScreen.tsx");

  test("recall-method selector lives on the Memory sub-page, not the settings tab", () => {
    // Recall now belongs to the Memory detail page (MemoryRecallCard),
    // rendered when the memory surface opens.
    expect(screen).toContain("function MemoryRecallCard(");
    expect(screen).toContain('label="Recall method"');
    expect(screen).toContain('surface === "memory" ? (');
    expect(screen).toContain("<MemoryRecallCard");
    expect(screen).toMatch(/workspace_indexer:\s*\{\s*embeddingProvider:/);
    for (const provider of ["auto", "transformers_js", "openai", "gemini", "ollama"]) {
      expect(screen).toContain(`value: "${provider}"`);
    }
    // It is no longer a section on the settings tab.
    expect(screen).not.toContain('<SettingsSection title="Memory">');
    expect(screen).not.toContain('label="Memory method"');
  });
});

describe("mobile: primary navigation", () => {
  const screen = read("screens/DashboardScreen.tsx");

  test("Tasks is a bottom tab and settings opens from the header gear", () => {
    expect(screen).toContain("tasks: CalendarCheck");
    expect(screen).toContain('activeTab === "tasks"');
    expect(screen).toContain('surface="tasks"');
    // Header gear still routes to the settings surface.
    expect(screen).toContain('onPress={() => selectTab("settings")}');
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

describe("mobile: assistant identity + custom instructions (web parity)", () => {
  const screen = read("screens/DashboardScreen.tsx");

  test("exposes identity fields and custom instructions that persist via updateSystemPrompt", () => {
    expect(screen).toContain('title="Assistant identity"');
    expect(screen).toContain('label="Name"');
    expect(screen).toContain('label="Custom instructions"');
    expect(screen).toContain("saveSystemPromptConfig");
    expect(screen).toContain("api.updateSystemPrompt");
    expect(screen).toContain("customPrompt: customPromptDraft");
  });
});

describe("mobile HIG: safe-area inset on the tab bar", () => {
  const screen = read("screens/DashboardScreen.tsx");

  test("floats the tab bar above the home indicator using safe-area insets", () => {
    expect(screen).toContain("useSafeAreaInsets");
    expect(screen).toContain("insets.bottom + MOBILE_NAV_CHROME.floatingMargin");
  });
});
