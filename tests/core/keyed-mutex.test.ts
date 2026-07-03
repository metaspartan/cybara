import { describe, expect, test } from "bun:test";
import { KeyedMutex } from "../../src/core/keyed-mutex";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("KeyedMutex", () => {
  test("serializes work for the same key in submission order", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    const a = mutex.run("s1", async () => {
      order.push("a-start");
      await tick(30);
      order.push("a-end");
    });
    const b = mutex.run("s1", async () => {
      order.push("b-start");
      await tick(5);
      order.push("b-end");
    });

    await Promise.all([a, b]);
    // b must not start until a has finished — no interleaving.
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  test("runs different keys concurrently", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    const a = mutex.run("s1", async () => {
      order.push("a-start");
      await tick(30);
      order.push("a-end");
    });
    const b = mutex.run("s2", async () => {
      order.push("b-start");
      await tick(5);
      order.push("b-end");
    });

    await Promise.all([a, b]);
    // Different keys overlap: b starts before a ends and finishes first.
    expect(order[0]).toBe("a-start");
    expect(order[1]).toBe("b-start");
    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
  });

  test("a rejected turn does not wedge the queue for that key", async () => {
    const mutex = new KeyedMutex();
    const first = mutex.run("s1", async () => {
      throw new Error("boom");
    });
    await expect(first).rejects.toThrow("boom");

    const second = await mutex.run("s1", async () => "recovered");
    expect(second).toBe("recovered");
  });

  test("propagates the callback's return value and drains keys", async () => {
    const mutex = new KeyedMutex();
    const value = await mutex.run("s1", async () => 42);
    expect(value).toBe(42);
    // After everything settles the key map is empty (no unbounded growth).
    await tick(5);
    expect(mutex.activeKeyCount).toBe(0);
  });

  test("preserves strict order across many queued calls", async () => {
    const mutex = new KeyedMutex();
    const seen: number[] = [];
    const calls = Array.from({ length: 20 }, (_, i) =>
      mutex.run("s1", async () => {
        await tick(i % 3);
        seen.push(i);
      })
    );
    await Promise.all(calls);
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});
