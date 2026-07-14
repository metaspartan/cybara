import { afterEach, describe, expect, test } from "bun:test";
import { nearbyRoutes } from "../../src/api/routes/nearby";
import { nearbyService } from "../../src/core/nearby";

afterEach(async () => {
  const update = nearbyRoutes["PUT /api/nearby/settings"];
  await update?.({ enabled: false, displayName: "Cybara", port: 4270, discoveryMinutes: 10 });
  nearbyService.stop();
});

describe("nearby routes", () => {
  test("registers the complete settings, pairing, and transfer contract", () => {
    expect(Object.keys(nearbyRoutes).sort()).toEqual(
      [
        "DELETE /api/nearby/discoverable",
        "DELETE /api/nearby/pairings/:id",
        "DELETE /api/nearby/peers/:id",
        "DELETE /api/nearby/transfers/:id",
        "GET /api/nearby",
        "POST /api/nearby/discoverable",
        "POST /api/nearby/pair",
        "POST /api/nearby/pair-address",
        "POST /api/nearby/pairings/:id/confirm",
        "POST /api/nearby/peers/:id/sessions",
        "POST /api/nearby/transfers/:id/accept",
        "PUT /api/nearby/peers/:id",
        "PUT /api/nearby/settings",
      ].sort()
    );
  });

  test("returns a default-off status and persists bounded settings", async () => {
    const statusRoute = nearbyRoutes["GET /api/nearby"];
    const updateRoute = nearbyRoutes["PUT /api/nearby/settings"];
    expect(statusRoute).toBeDefined();
    expect(updateRoute).toBeDefined();

    const initial = (await statusRoute?.()) as {
      settings: { enabled: boolean };
      pairedPeers: unknown[];
    };
    expect(initial.settings.enabled).toBe(false);
    expect(initial.pairedPeers).toEqual([]);

    const updated = (await updateRoute?.({
      enabled: false,
      displayName: "Nearby Test",
      port: 1,
      discoveryMinutes: 500,
    })) as {
      success: boolean;
      settings: {
        displayName: string;
        port: number;
        discoveryMinutes: number;
        autoAdvertise: boolean;
      };
    };
    expect(updated.success).toBe(true);
    expect(updated.settings).toEqual({
      enabled: false,
      displayName: "Nearby Test",
      port: 1024,
      discoveryMinutes: 60,
      autoAdvertise: true,
    });
  });
});
