import { afterEach, describe, expect, test } from "bun:test";
import { resolveModelMaxOutputTokens } from "../../src/core/agent-model-limits";
import { discoverProviderModels } from "../../src/core/model-discovery";
import { providerManager } from "../../src/core/providers";

const createdProviderIds: string[] = [];

afterEach(() => {
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
});

describe("provider model discovery", () => {
  test("persists OpenAI-compatible endpoint metadata", async () => {
    const provider = providerManager.create({
      provider: "atlascloud",
      name: "Atlas Cloud Discovery Test",
      api_key: "atlas-test-key",
    });
    createdProviderIds.push(provider.id);

    const result = await discoverProviderModels(provider.id, {
      request: async () =>
        Response.json({
          data: [
            {
              id: "qwen/qwen3.5-397b-a17b",
              name: "Qwen3.5 397BA17B",
              context_length: 262144,
              max_output_length: 65536,
              input_modalities: ["text", "image", "video"],
              supported_features: ["json_mode", "structured_outputs", "tools", "reasoning"],
            },
          ],
        }),
      discoverCatalog: async () => [],
    });

    expect(result.source).toBe("endpoint");
    const discovered = providerManager.getModels(provider.id)[0];
    expect(discovered?.model_name).toBe("Qwen3.5 397BA17B");
    expect(discovered?.context_window).toBe(262144);
    expect(discovered?.max_tokens).toBe(65536);
    expect(Boolean(discovered?.reasoning)).toBe(true);
    expect(discovered?.input_types).toBe('["text","image","video"]');
  });

  test("reads the context window a vLLM endpoint reports as max_model_len", async () => {
    const provider = providerManager.create({
      provider: "custom",
      name: "vLLM Discovery Test",
      api_key: "vllm-key",
      base_url: "http://192.0.2.10:8000/v1",
    });
    createdProviderIds.push(provider.id);

    const result = await discoverProviderModels(provider.id, {
      request: async () =>
        Response.json({
          data: [
            {
              id: "unsloth/Qwen3.6-35B-A3B-NVFP4-Fast",
              object: "model",
              owned_by: "vllm",
              max_model_len: 262144,
            },
          ],
        }),
      discoverCatalog: async () => [],
    });

    expect(result.source).toBe("endpoint");
    const discovered = providerManager
      .getModels(provider.id)
      .find((model) => model.model_id === "unsloth/Qwen3.6-35B-A3B-NVFP4-Fast");
    expect(discovered?.context_window).toBe(262144);
  });

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

  test("discovers models from custom provider API paths without a v1 segment", async () => {
    const provider = providerManager.create({
      provider: "custom",
      name: "Custom Endpoint Discovery Test",
      api_key: "custom-discovery-key",
      base_url: "http://127.0.0.1:8765/api",
    });
    createdProviderIds.push(provider.id);
    let requestedUrl = "";
    let requestedHeaders = new Headers();

    const result = await discoverProviderModels(provider.id, {
      request: async (input, init) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        return Response.json({ data: [{ id: "private-model" }] });
      },
      discoverCatalog: async () => [],
    });

    expect(result.source).toBe("endpoint");
    expect(requestedUrl).toBe("http://127.0.0.1:8765/api/models");
    expect(requestedHeaders.get("Authorization")).toBe("Bearer custom-discovery-key");
    expect(providerManager.getModels(provider.id)[0]?.model_id).toBe("private-model");
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

  test("persists Kimi coding-plan model capabilities from the authenticated endpoint", async () => {
    const provider = providerManager.create({
      provider: "kimi-code-oauth",
      name: "Kimi Code Discovery Test",
      access_token: "kimi-oauth-token",
    });
    createdProviderIds.push(provider.id);
    let headers = new Headers();

    const result = await discoverProviderModels(provider.id, {
      request: async (_input, init) => {
        headers = new Headers(init?.headers);
        return Response.json({
          data: [
            {
              id: "k3",
              display_name: "Kimi K3",
              context_length: 1_048_576,
              supports_reasoning: true,
              supports_image_in: true,
              supports_video_in: false,
              supports_tool_use: true,
              think_efforts: { support: true, valid_efforts: ["max"], default_effort: "max" },
            },
          ],
        });
      },
      discoverCatalog: async () => [],
    });

    expect(result.source).toBe("endpoint");
    expect(headers.get("Authorization")).toBe("Bearer kimi-oauth-token");
    expect(headers.get("User-Agent")).toMatch(/^Cybara\//);
    expect(headers.get("X-Msh-Platform")).toBe("kimi_code_cli");
    const discovered = providerManager.getModels(provider.id)[0];
    expect(discovered?.model_id).toBe("k3");
    expect(discovered?.model_name).toBe("Kimi K3");
    expect(discovered?.context_window).toBe(1_048_576);
    expect(discovered?.max_tokens).toBe(32_768);
    expect(Boolean(discovered?.reasoning)).toBe(true);
    expect(discovered?.input_types).toBe('["text","image"]');
    expect(resolveModelMaxOutputTokens("kimi-code-oauth", provider.id, "k3")).toBe(32_768);
  });
});
