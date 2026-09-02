import { describe, expect, test } from "bun:test";
import { runtimeRoutes } from "../../src/api/routes/runtime-routes";

describe("computer-use preview focus route", () => {
  test("rejects remote and forwarded clients before focusing a host app", async () => {
    const handler = runtimeRoutes["POST /api/computer-use/preview/focus"];
    expect(handler).toBeFunction();

    const remote = await handler?.(
      {},
      { sessionId: "focus-session" },
      { clientIp: "192.168.1.20", headers: { host: "192.168.1.10:4269" } }
    );
    const forwarded = await handler?.(
      {},
      { sessionId: "focus-session" },
      {
        clientIp: "127.0.0.1",
        headers: { host: "127.0.0.1:4269", "x-forwarded-for": "192.168.1.20" },
      }
    );

    expect(remote).toEqual({ success: false, error: "Desktop app focus is local-only" });
    expect(forwarded).toEqual(remote);
  });

  test("validates local focus requests without launching a driver", async () => {
    const handler = runtimeRoutes["POST /api/computer-use/preview/focus"];
    const missingSession = await handler?.({}, {}, { clientIp: "127.0.0.1", headers: {} });
    const missingPreview = await handler?.(
      {},
      { sessionId: "missing-focus-preview" },
      { clientIp: "127.0.0.1", headers: {} }
    );

    expect(missingSession).toEqual({ success: false, error: "Session ID is required" });
    expect(missingPreview).toEqual({
      success: false,
      error: "No desktop app is available to focus for this chat",
    });
  });
});
