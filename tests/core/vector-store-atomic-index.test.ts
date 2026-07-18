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

  test("embeds only appended file content while preserving existing chunks", async () => {
    const store = new VectorStore();
    await store.ensureReady();
    await store.indexFile("incremental.md", "The original durable marker remains searchable.");

    const embeddedBatches: string[][] = [];
    const internals = store as unknown as VectorStoreInternals;
    internals.provider = {
      id: "voyage",
      model: "incremental-test-provider",
      dimensions: 1,
      embedQuery: async () => [1],
      embedBatch: async (texts) => {
        embeddedBatches.push([...texts]);
        return texts.map(() => [1]);
      },
    };
    internals.providerReady = Promise.resolve();
    internals.providerSource = "voyage";

    const appended = await store.appendFileContent(
      "incremental.md",
      "\n## fact\n\nThe newly appended durable marker is indexed independently.\n",
      1
    );

    expect(appended).toBe(1);
    expect(embeddedBatches.flat()).toEqual([
      "## fact\n\nThe newly appended durable marker is indexed independently.\n",
    ]);

    internals.provider = null;
    internals.providerSource = "none";
    const original = await store.search("original durable marker");
    const added = await store.search("newly appended durable marker");
    expect(original.some((result) => result.content.includes("original durable marker"))).toBe(
      true
    );
    expect(added.some((result) => result.startLine === 3)).toBe(true);
    store.close();
  });

  test("requests a full replacement when the prior file is not indexed", async () => {
    const store = new VectorStore();
    await store.ensureReady();
    expect(await store.appendFileContent("missing.md", "New content", 0)).toBeNull();
    store.close();
  });
});
