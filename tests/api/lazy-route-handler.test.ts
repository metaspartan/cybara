import { describe, expect, test } from "bun:test";
import { type ApiRouteHandler, createLazyApiRouteHandler } from "../../src/api/lazy-route-handler";

describe("createLazyApiRouteHandler", () => {
  test("defers loading until the first request and reuses the handler", async () => {
    let loads = 0;
    const loadedHandler: ApiRouteHandler = async (request) => ({
      status: 200,
      headers: {},
      body: request.url,
    });
    const handler = createLazyApiRouteHandler(async () => {
      loads += 1;
      return loadedHandler;
    });

    expect(loads).toBe(0);
    const first = await handler({ method: "GET", url: "/first", headers: {} });
    const second = await handler({ method: "GET", url: "/second", headers: {} });

    expect(first.body).toBe("/first");
    expect(second.body).toBe("/second");
    expect(loads).toBe(1);
  });

  test("shares one in-flight load across concurrent requests", async () => {
    let loads = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = createLazyApiRouteHandler(async () => {
      loads += 1;
      await gate;
      return async () => ({ status: 204, headers: {} });
    });

    const first = handler({ method: "GET", url: "/first", headers: {} });
    const second = handler({ method: "GET", url: "/second", headers: {} });
    expect(loads).toBe(1);
    release?.();

    expect((await first).status).toBe(204);
    expect((await second).status).toBe(204);
    expect(loads).toBe(1);
  });
});
