import { beforeEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import { createEmbeddingProvider } from "../../src/core/memory/embeddings";

describe("voyage embedding provider wiring", () => {
  beforeEach(() => {
    delete process.env.VOYAGE_API_KEY;
    config.set("integration_credentials", null);
  });

  test("voyage is a recognized provider that reports a clear reason when unconfigured", async () => {
    const result = await createEmbeddingProvider({ provider: "voyage" });
    expect(result.source).toBe("none");
    expect(result.fallbackReason).toContain("Voyage AI credential is not configured");
  });

  test("selecting voyage is not silently coerced to auto", async () => {
    const result = await createEmbeddingProvider({ provider: "voyage", model: "voyage-3" });
    expect(result.fallbackReason).toContain("Voyage AI credential is not configured");
  });
});
