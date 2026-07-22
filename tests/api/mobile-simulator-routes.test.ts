import { describe, expect, test } from "bun:test";
import { mobileSimulatorRoutes } from "../../src/api/routes/mobile-simulator-routes";

describe("mobile simulator routes", () => {
  test("reports both simulator platforms", async () => {
    const handler = mobileSimulatorRoutes["GET /api/simulators/status"];
    expect(handler).toBeFunction();
    const response = await handler?.({}, {});
    expect(response).toMatchObject({
      success: true,
      data: {
        ios: { platform: "ios" },
        android: { platform: "android" },
      },
    });
  });

  test("exposes a dedicated screenshot save route", () => {
    expect(mobileSimulatorRoutes["POST /api/simulators/:platform/screenshot"]).toBeFunction();
  });

  test("rejects invalid action and platform values before execution", async () => {
    const action = mobileSimulatorRoutes["POST /api/simulators/:platform/action"];
    expect(action).toBeFunction();
    await expect(action?.({ action: "erase" }, { platform: "ios" })).rejects.toThrow(
      "Invalid simulator action"
    );
    await expect(action?.({ action: "tap" }, { platform: "windows" })).rejects.toThrow(
      "Invalid simulator platform"
    );
  });
});
