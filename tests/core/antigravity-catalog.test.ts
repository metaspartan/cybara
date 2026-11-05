import { describe, expect, test } from "bun:test";
import { providers } from "../../src/core/providers";

interface CatalogModel {
  id: string;
  context: number;
  maxTokens: number;
  reasoning: boolean;
  input: readonly string[];
}

const liveVerifiedModels: ReadonlyArray<Pick<CatalogModel, "id" | "context" | "maxTokens">> = [
  { id: "claude-opus-5-5-medium", context: 1_000_000, maxTokens: 128_000 },
  { id: "claude-sonnet-5-5-medium", context: 1_000_000, maxTokens: 128_000 },
  { id: "gemini-3.8-flash-tiered", context: 1_048_576, maxTokens: 65_536 },
  { id: "gemini-3.5-flash-lite", context: 1_048_576, maxTokens: 65_535 },
  { id: "gpt-oss-120b-medium", context: 131_072, maxTokens: 32_768 },
];

const catalog = (): readonly CatalogModel[] =>
  providers.antigravity.models as readonly CatalogModel[];

describe("Antigravity model catalog", () => {
  test("lists the models reported by the Antigravity backend with their reported limits", () => {
    for (const expected of liveVerifiedModels) {
      const model = catalog().find((entry) => entry.id === expected.id);
      expect(model, expected.id).toBeDefined();
      expect(model?.context).toBe(expected.context);
      expect(model?.maxTokens).toBe(expected.maxTokens);
      expect(model?.reasoning).toBe(true);
    }
  });

  test("has unique model ids and sane limits for every entry", () => {
    const ids = catalog().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const model of catalog()) {
      expect(model.context).toBeGreaterThan(0);
      expect(model.maxTokens).toBeGreaterThan(0);
      expect(model.maxTokens).toBeLessThanOrEqual(model.context);
      expect(model.input).toContain("text");
    }
  });

  test("keeps the previously shipped models selectable", () => {
    const ids = catalog().map((entry) => entry.id);
    for (const id of [
      "gemini-3.6-flash",
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
      "claude-opus-4-6",
    ]) {
      expect(ids).toContain(id);
    }
  });
});
