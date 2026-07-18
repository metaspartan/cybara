import { describe, expect, test } from "bun:test";
import type { EmbeddingProvider, EmbeddingProviderId } from "../../src/core/memory/embeddings";
import { VectorStore } from "../../src/core/memory/vector-store";

interface VectorStoreInternals {
  provider: EmbeddingProvider | null;
  providerReady: Promise<void>;
  providerSource: EmbeddingProviderId;
}

describe("VectorStore atomic indexing", () => {
  test("preserves the previous file index when replacement embeddings fail", async () => {
    const store = new VectorStore();
    await store.ensureReady();
    await store.indexFile("MEMORY.md", "The preserved marker remains searchable after failure.");

    const internals = store as unknown as VectorStoreInternals;
    internals.provider = {
      id: "voyage",
      model: "failing-test-provider",
      dimensions: 1,
      embedQuery: async () => [1],
      embedBatch: async () => [],
    };
    internals.providerReady = Promise.resolve();
    internals.providerSource = "voyage";

    await expect(
      store.indexFile("MEMORY.md", "The replacement marker must never become visible.")
    ).rejects.toThrow("vectors for");

    internals.provider = null;
    internals.providerSource = "none";
    const results = await store.search("preserved marker");
    expect(results.some((result) => result.content.includes("preserved marker"))).toBe(true);
    expect(results.some((result) => result.content.includes("replacement marker"))).toBe(false);
    store.close();
  });
});
