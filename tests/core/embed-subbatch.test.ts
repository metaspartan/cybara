import { describe, expect, test } from "bun:test";
import { embedInSubBatches } from "../../src/core/memory/embeddings";

const fakeEmbed = (batch: string[]): Promise<number[][]> =>
  Promise.resolve(batch.map((t) => [Number(t)]));

describe("embedInSubBatches", () => {
  test("preserves input order across sub-batches", async () => {
    const texts = Array.from({ length: 250 }, (_, i) => String(i));
    const out = await embedInSubBatches(texts, fakeEmbed, { batchSize: 96, concurrency: 4 });
    expect(out.length).toBe(250);
    expect(out.map((v) => v[0])).toEqual(texts.map(Number));
  });

  test("splits into the expected number of requests", async () => {
    let calls = 0;
    const counting = (batch: string[]) => {
      calls += 1;
      return fakeEmbed(batch);
    };
    const texts = Array.from({ length: 200 }, (_, i) => String(i));
    await embedInSubBatches(texts, counting, { batchSize: 96, concurrency: 8 });
    expect(calls).toBe(3);
  });

  test("small inputs make a single call", async () => {
    let calls = 0;
    await embedInSubBatches(
      ["1", "2"],
      (b) => {
        calls += 1;
        return fakeEmbed(b);
      },
      { batchSize: 96 }
    );
    expect(calls).toBe(1);
  });

  test("never exceeds the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const tracked = async (batch: string[]) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return fakeEmbed(batch);
    };
    const texts = Array.from({ length: 500 }, (_, i) => String(i));
    await embedInSubBatches(texts, tracked, { batchSize: 50, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  test("rejects a provider response with the wrong number of vectors", async () => {
    expect(
      embedInSubBatches(["1", "2", "3"], async () => [[1], [2]], {
        batchSize: 2,
        concurrency: 2,
      })
    ).rejects.toThrow("vectors for");
    expect(embedInSubBatches(["1", "2"], async () => [[1]])).rejects.toThrow("vectors for");
  });
});
