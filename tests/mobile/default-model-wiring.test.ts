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
