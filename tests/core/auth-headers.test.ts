import { describe, expect, test } from "bun:test";
import { applyProviderApiKey } from "../../src/core/llm/auth-headers";
import { providers } from "../../src/core/providers";

describe("applyProviderApiKey", () => {
  test("defaults to Authorization: Bearer", () => {
    const h = applyProviderApiKey({}, "sk-123");
    expect(h.Authorization).toBe("Bearer sk-123");
    expect(h["api-key"]).toBeUndefined();
  });

  test("uses a custom api-key header when specified (Azure)", () => {
    const h = applyProviderApiKey({}, "azkey", "api-key");
    expect(h["api-key"]).toBe("azkey");
    expect(h.Authorization).toBeUndefined();
  });

  test("no auth leaves headers untouched", () => {
    const h = applyProviderApiKey({ "Content-Type": "application/json" }, "");
    expect(h.Authorization).toBeUndefined();
    expect(h["Content-Type"]).toBe("application/json");
  });
});

describe("Azure provider registry entries", () => {
  test("azure uses openai-completions with api-key header auth", () => {
    const azure = providers.azure as { api?: string; authType?: string; apiKeyHeader?: string };
    expect(azure.api).toBe("openai-completions");
    expect(azure.authType).toBe("api_key");
    expect(azure.apiKeyHeader).toBe("api-key");
  });

  test("azure_foundry uses api-key header auth", () => {
    const foundry = providers.azure_foundry as { apiKeyHeader?: string };
    expect(foundry.apiKeyHeader).toBe("api-key");
  });
});
