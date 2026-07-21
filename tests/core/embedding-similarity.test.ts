import { describe, expect, test } from "bun:test";
import { cosineSimilarity, findTopKSimilar } from "../../src/core/memory/embeddings";

describe("embedding similarity", () => {
  test("rejects vectors from incompatible embedding models", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow("Embedding dimension mismatch");
    expect(() => findTopKSimilar([1, 0], [{ id: "wrong-model", embedding: [1, 0, 0] }], 1)).toThrow(
      "Embedding dimension mismatch"
    );
  });

  test("ranks compatible non-empty vectors", () => {
    expect(
      findTopKSimilar(
        [1, 0],
        [
          { id: "near", embedding: [0.9, 0.1] },
          { id: "far", embedding: [0, 1] },
        ],
        2
      ).map((entry) => entry.id)
    ).toEqual(["near"]);
  });
});
