import { describe, expect, test } from "bun:test";
import { extractModelsDevProvider, PROVIDER_TO_MODELS_DEV } from "../../src/core/models-dev";

const SAMPLE = {
  anthropic: {
    id: "anthropic",
    models: {
      "claude-opus-4-8": {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        limit: { context: 1000000, output: 128000 },
        reasoning: true,
        modalities: { input: ["text", "image"] },
      },
      "claude-haiku-4-5": {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        limit: { context: 200000, output: 64000 },
        reasoning: false,
        modalities: { input: ["text"] },
      },
    },
  },
};

describe("models.dev extraction", () => {
  test("maps provider models with metadata", () => {
    const models = extractModelsDevProvider(SAMPLE, "anthropic");
    expect(models).toHaveLength(2);
    const opus = models.find((m) => m.id === "claude-opus-4-8")!;
    expect(opus.contextWindow).toBe(1000000);
    expect(opus.maxTokens).toBe(128000);
    expect(opus.reasoning).toBe(true);
    expect(opus.input).toEqual(["text", "image"]);
  });

  test("returns empty for unknown provider or garbage", () => {
    expect(extractModelsDevProvider(SAMPLE, "nope")).toEqual([]);
    expect(extractModelsDevProvider(null, "anthropic")).toEqual([]);
    expect(extractModelsDevProvider({}, "anthropic")).toEqual([]);
  });

  test("provider mapping covers major providers", () => {
    for (const id of [
      "openai",
      "meta",
      "anthropic",
      "google",
      "xai",
      "deepseek",
      "mistral",
      "groq",
      "featherless",
      "longcat",
      "opencode_zen",
      "opencode-go",
    ]) {
      expect(PROVIDER_TO_MODELS_DEV[id]).toBeTruthy();
    }
  });
});
