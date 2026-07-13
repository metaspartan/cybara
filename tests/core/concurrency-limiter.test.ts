import { describe, expect, test } from "bun:test";
import { ConcurrencyLimiter } from "../../src/core/concurrency-limiter";

describe("ConcurrencyLimiter", () => {
  test("never grants more than the configured number of permits", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let maximumActive = 0;

    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const release = await limiter.acquire(undefined, 1_000);
        expect(release).toBeDefined();
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Bun.sleep(10);
        active -= 1;
        release?.();
      })
    );

    expect(maximumActive).toBe(2);
  });

  test("removes aborted and timed-out waiters", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const release = await limiter.acquire();
    const controller = new AbortController();
    const aborted = limiter.acquire(controller.signal, 1_000);
    const timedOut = limiter.acquire(undefined, 10);

    controller.abort();

    expect(await aborted).toBeUndefined();
    expect(await timedOut).toBeUndefined();
    release?.();

    const next = await limiter.acquire(undefined, 100);
    expect(next).toBeDefined();
    next?.();
  });
});
