import { afterEach, describe, expect, test } from "bun:test";
import { discoverProviderModels } from "../../src/core/model-discovery";
import { providerManager } from "../../src/core/providers";

const createdProviderIds: string[] = [];

afterEach(() => {
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
});

describe("provider model discovery", () => {
  test("resolves models.dev by provider type while persisting under the provider id", async () => {
    const provider = providerManager.create({
      provider: "opencode-go",
      name: "OpenCode Go Discovery Test",
    });
    createdProviderIds.push(provider.id);
    const requestedProviderTypes: string[] = [];

    const result = await discoverProviderModels(provider.id, {
      discoverCatalog: async (providerType) => {
        requestedProviderTypes.push(providerType);
        return [
          {
            id: "future-go-model",
            name: "Future Go Model",
            contextWindow: 750000,
            maxTokens: 96000,
            reasoning: true,
            input: ["text", "image"],
          },
        ];
      },
    });

    expect(requestedProviderTypes).toEqual(["opencode-go"]);
    expect(result.source).toBe("models.dev");
    expect(result.added).toBe(1);
    const discovered = providerManager
      .getModels(provider.id)
      .find((model) => model.model_id === "future-go-model");
    expect(discovered?.provider_id).toBe(provider.id);
    expect(discovered?.context_window).toBe(750000);
    expect(discovered?.max_tokens).toBe(96000);
    expect(Boolean(discovered?.reasoning)).toBe(true);
    expect(discovered?.input_types).toBe('["text","image"]');
  });

  test("enriches live endpoint models with models.dev metadata", async () => {
    const provider = providerManager.create({
      provider: "opencode-go",
      name: "OpenCode Go Live Discovery Test",
      api_key: "test-key",
    });
    createdProviderIds.push(provider.id);

    const result = await discoverProviderModels(provider.id, {
      request: async () =>
        new Response(JSON.stringify({ data: [{ id: "live-go-model", object: "model" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      discoverCatalog: async () => [
        {
          id: "live-go-model",
          name: "Live Go Model",
          contextWindow: 900000,
          maxTokens: 128000,
          reasoning: true,
          input: ["text", "image", "video"],
          costInput: 0.25,
          costOutput: 1.5,
        },
      ],
    });

    expect(result.source).toBe("endpoint");
    const discovered = providerManager
      .getModels(provider.id)
      .find((model) => model.model_id === "live-go-model");
    expect(discovered?.model_name).toBe("Live Go Model");
    expect(discovered?.context_window).toBe(900000);
    expect(discovered?.max_tokens).toBe(128000);
    expect(discovered?.cost_input).toBe(0.25);
    expect(discovered?.cost_output).toBe(1.5);
  });

  test("uses the authenticated Codex picker list as the authoritative account catalog", async () => {
    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex Account Discovery Test",
      access_token: "codex-test-token",
    });
    createdProviderIds.push(provider.id);

    const result = await discoverProviderModels(provider.id, {
      request: async () =>
        new Response(
          JSON.stringify({
            models: [
              {
                slug: "gpt-5.6-sol",
                display_name: "GPT-5.6-Sol",
                visibility: "list",
                show_in_picker: true,
                max_context_window: 372000,
                max_output_tokens: 128000,
                supported_reasoning_levels: [{ effort: "max" }],
                input_modalities: ["text", "image"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });

    expect(result.source).toBe("openai-codex");
    expect(providerManager.getModels(provider.id).map((model) => model.model_id)).toEqual([
      "gpt-5.6-sol",
    ]);
    expect(providerManager.getModels(provider.id)[0]?.context_window).toBe(372000);
  });
});
