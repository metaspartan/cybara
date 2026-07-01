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

  test("renders a memory method selector persisting to workspace_indexer", () => {
    expect(screen).toContain('label="Memory method"');
    expect(screen).toMatch(/workspace_indexer:\s*\{\s*embeddingProvider:/);
    for (const provider of ["auto", "transformers_js", "openai", "gemini", "ollama"]) {
      expect(screen).toContain(`value: "${provider}"`);
    }
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

  test("uses safe-area insets so the tab bar clears the home indicator", () => {
    expect(screen).toContain("useSafeAreaInsets");
    expect(screen).toContain("insets.bottom");
    expect(screen).toContain("MOBILE_NAV_CHROME.height + insets.bottom");
  });
});
