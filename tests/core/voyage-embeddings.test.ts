import { describe, expect, test, beforeEach } from "bun:test";
import { createEmbeddingProvider } from "../../src/core/memory/embeddings";

describe("voyage embedding provider wiring", () => {
  beforeEach(() => {
    delete process.env.VOYAGE_API_KEY;
  });

  test("voyage is a recognized provider that reports a clear reason when unconfigured", async () => {
    const result = await createEmbeddingProvider({ provider: "voyage" });
    // No key => graceful null provider with an actionable reason (not "auto" fallthrough).
    expect(result.source).toBe("none");
    expect(result.fallbackReason).toContain("VOYAGE_API_KEY");
  });

  test("selecting voyage is not silently coerced to auto", async () => {
    // If normalization dropped 'voyage', the reason would name a different provider.
    const result = await createEmbeddingProvider({ provider: "voyage", model: "voyage-3" });
    expect(result.fallbackReason).toContain("VOYAGE_API_KEY");
  });
});
