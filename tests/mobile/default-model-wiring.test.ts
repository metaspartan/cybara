import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile: default model setting", () => {
  const screen = read("screens/DashboardScreen.tsx");
  const api = read("lib/api.ts");

  test("ProviderSummary carries models and the normalizer extracts them", () => {
    expect(api).toContain("models?: string[]");
    expect(api).toMatch(/Array\.isArray\(record\?\.models\)/);
    expect(api).toMatch(/Array\.isArray\(info\?\.models\)/);
  });

  test("default model field persists to the gateway via config", () => {
    expect(screen).toContain("defaultModelDraft");
    expect(screen).toContain("saveDefaultModel");
    expect(screen).toMatch(/saveConfigPatch\(\s*\n?\s*"default_model"/);
    expect(screen).toContain('label="Default model"');
  });

  test("draft syncs from loaded config and only saves on change", () => {
    expect(screen).toContain("setDefaultModelDraft(defaultModel)");
    expect(screen).toContain("if (next === defaultModel) return;");
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
