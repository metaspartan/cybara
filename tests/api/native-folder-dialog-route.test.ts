import { describe, expect, test } from "bun:test";
import { runtimeRoutes } from "../../src/api/routes/runtime-routes";

describe("native folder dialog route", () => {
  test("rejects remote and forwarded clients before opening a host dialog", async () => {
    const handler = runtimeRoutes["POST /api/system/folder-dialog"];
    expect(handler).toBeFunction();

    const remote = await handler?.(
      {},
      {},
      {
        clientIp: "192.168.1.20",
        headers: { host: "192.168.1.10:4269" },
      }
    );
    const forwarded = await handler?.(
      {},
      {},
      {
        clientIp: "127.0.0.1",
        headers: {
          host: "127.0.0.1:4269",
          "x-forwarded-for": "192.168.1.20",
        },
      }
    );

    expect(remote).toEqual({
      success: false,
      supported: false,
      error: "Native folder dialog is local-only",
    });
    expect(forwarded).toEqual(remote);
  });
});
