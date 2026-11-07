import { describe, expect, test } from "bun:test";
import { providers } from "../../src/core/providers";

interface CatalogModel {
  id: string;
  name: string;
  context: number;
  maxTokens: number;
  input: readonly string[];
}

const modelsOf = (provider: "anthropic" | "openai"): readonly CatalogModel[] =>
  providers[provider].models as readonly CatalogModel[];

const find = (provider: "anthropic" | "openai", id: string): CatalogModel | undefined =>
  modelsOf(provider).find((model) => model.id === id);

describe("Anthropic catalog limits match the models endpoint", () => {
  const reported: ReadonlyArray<[string, number, number]> = [
    ["claude-opus-5-5", 1_000_000, 128_000],
    ["claude-sonnet-5-5", 1_000_000, 128_000],
    ["claude-haiku-5-5", 1_000_000, 128_000],
    ["claude-opus-4-8", 1_000_000, 128_000],
    ["claude-opus-4-7", 1_000_000, 128_000],
    ["claude-opus-4-6", 1_000_000, 128_000],
    ["claude-sonnet-4-6", 1_000_000, 128_000],
    ["claude-opus-4-5-20251101", 200_000, 64_000],
    ["claude-haiku-4-5-20251001", 200_000, 64_000],
  ];

  for (const [id, context, maxTokens] of reported) {
    test(`${id} reports ${context} context and ${maxTokens} output`, () => {
      const model = find("anthropic", id);
      expect(model, id).toBeDefined();
      expect(model?.context).toBe(context);
      expect(model?.maxTokens).toBe(maxTokens);
    });
  }
});

describe("OpenAI catalog covers the current GPT-6 family", () => {
  for (const id of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna"]) {
    test(`${id} is listed with the documented 1.05M context and 128K output`, () => {
      const model = find("openai", id);
      expect(model, id).toBeDefined();
      expect(model?.context).toBe(1_050_000);
      expect(model?.maxTokens).toBe(128_000);
      expect(model?.input).toEqual(expect.arrayContaining(["text", "image"]));
    });
  }
});
