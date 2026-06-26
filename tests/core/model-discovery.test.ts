import { describe, expect, test } from "bun:test";
import { discoverProviderModels } from "../../src/core/model-discovery";

describe("model discovery", () => {
  test("returns error for unknown provider", async () => {
    const result = await discoverProviderModels("nonexistent-provider-id");
    expect(result.discovered).toBe(0);
    expect(result.added).toBe(0);
    expect(result.error).toBeTruthy();
  });

  test("result has correct shape", async () => {
    const result = await discoverProviderModels("fake");
    expect(result).toHaveProperty("providerId");
    expect(result).toHaveProperty("discovered");
    expect(result).toHaveProperty("added");
    expect(result).toHaveProperty("models");
    expect(Array.isArray(result.models)).toBe(true);
  });
});
