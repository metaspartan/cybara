import { afterEach, describe, expect, test } from "bun:test";
import { createCachedRouteHandler, invalidateCachedRoute } from "../../src/api/route-cache";

const routeKeys = new Set<string>();

function cachedHandler(
  ttlMs: number,
  handler: () => Promise<unknown> | unknown
): { key: string; run: () => Promise<unknown> } {
  const key = `GET /test/${crypto.randomUUID()}`;
  routeKeys.add(key);
  const run = createCachedRouteHandler(key, ttlMs, handler);
  return { key, run: async () => await run() };
}

afterEach(() => {
  for (const key of routeKeys) invalidateCachedRoute(key);
  routeKeys.clear();
});

describe("route response cache", () => {
  test("deduplicates concurrent cold requests", async () => {
    let calls = 0;
    const { run } = cachedHandler(1_000, async () => {
      calls += 1;
      await Bun.sleep(20);
      return { calls };
    });

    const results = await Promise.all([run(), run(), run()]);

    expect(calls).toBe(1);
    expect(results).toEqual([{ calls: 1 }, { calls: 1 }, { calls: 1 }]);
  });

  test("serves stale data while one refresh runs", async () => {
    let calls = 0;
    const { run } = cachedHandler(5, async () => {
      calls += 1;
      await Bun.sleep(15);
      return { calls };
    });

    expect(await run()).toEqual({ calls: 1 });
    await Bun.sleep(10);

    const startedAt = performance.now();
    const stale = await run();
    const elapsedMs = performance.now() - startedAt;
    const secondStale = await run();

    expect(stale).toEqual({ calls: 1 });
    expect(secondStale).toEqual({ calls: 1 });
    expect(elapsedMs).toBeLessThan(10);
    expect(calls).toBe(2);

    await Bun.sleep(20);
    expect(await run()).toEqual({ calls: 2 });
  });

  test("invalidates cached data immediately", async () => {
    let calls = 0;
    const { key, run } = cachedHandler(10_000, () => ({ calls: ++calls }));

    expect(await run()).toEqual({ calls: 1 });
    expect(await run()).toEqual({ calls: 1 });
    invalidateCachedRoute(key);
    expect(await run()).toEqual({ calls: 2 });
  });

  test("isolates cached pages by normalized query parameters", async () => {
    const key = `GET /test/${crypto.randomUUID()}`;
    routeKeys.add(key);
    let calls = 0;
    const run = createCachedRouteHandler(key, 10_000, (_body, params) => ({
      call: ++calls,
      page: params?.page,
    }));

    expect(await run(undefined, { pageSize: "20", page: "1" })).toEqual({ call: 1, page: "1" });
    expect(await run(undefined, { page: "1", pageSize: "20" })).toEqual({ call: 1, page: "1" });
    expect(await run(undefined, { page: "2", pageSize: "20" })).toEqual({ call: 2, page: "2" });
    invalidateCachedRoute(key);
    expect(await run(undefined, { page: "2", pageSize: "20" })).toEqual({ call: 3, page: "2" });
  });

  test("does not restore an invalidated in-flight response", async () => {
    let calls = 0;
    const { key, run } = cachedHandler(10_000, async () => {
      calls += 1;
      const call = calls;
      await Bun.sleep(call === 1 ? 20 : 1);
      return { call };
    });

    const staleRequest = run();
    await Bun.sleep(5);
    invalidateCachedRoute(key);
    expect(await run()).toEqual({ call: 2 });
    expect(await staleRequest).toEqual({ call: 1 });
    expect(await run()).toEqual({ call: 2 });
  });
});
