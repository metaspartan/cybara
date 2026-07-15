import { describe, expect, test } from "bun:test";
import { runNearbyCommand } from "../../src/cli-nearby";

interface RequestCall {
  endpoint: string;
  options?: RequestInit;
}

const status = {
  settings: {
    enabled: false,
    displayName: "Workstation",
    port: 4270,
    discoveryMinutes: 10,
    autoAdvertise: true,
  },
  running: false,
  discoverableUntil: null,
  localAddresses: ["http://192.168.1.15:4270"],
  discoveredPeers: [],
  pairedPeers: [],
  pairings: [],
  incomingTransfers: [],
};

describe("nearby CLI", () => {
  test("enables nearby through the shared gateway contract", async () => {
    const calls: RequestCall[] = [];
    const fetchAPI = async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
      calls.push({ endpoint, options });
      if (endpoint === "/api/nearby") return status as T;
      return { status: { ...status, settings: { ...status.settings, enabled: true } } } as T;
    };
    await runNearbyCommand(["enable"], fetchAPI);
    expect(calls.map((call) => call.endpoint)).toEqual(["/api/nearby", "/api/nearby/settings"]);
    expect(calls[1]?.options?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1]?.options?.body))).toEqual({
      ...status.settings,
      enabled: true,
    });
  });

  test("sends a session only to the selected trusted peer", async () => {
    const calls: RequestCall[] = [];
    const fetchAPI = async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
      calls.push({ endpoint, options });
      return { transferId: "transfer-1" } as T;
    };
    await runNearbyCommand(["send", "peer/a", "session-1"], fetchAPI);
    expect(calls[0]?.endpoint).toBe("/api/nearby/peers/peer%2Fa/sessions");
    expect(calls[0]?.options?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.options?.body))).toEqual({ sessionId: "session-1" });
  });

  test("changes automatic import only for the selected paired device", async () => {
    const calls: RequestCall[] = [];
    const fetchAPI = async <T>(endpoint: string, options?: RequestInit): Promise<T | null> => {
      calls.push({ endpoint, options });
      return { syncEnabled: true } as T;
    };
    await runNearbyCommand(["auto-import", "peer/a", "on"], fetchAPI);
    expect(calls[0]?.endpoint).toBe("/api/nearby/peers/peer%2Fa");
    expect(calls[0]?.options?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]?.options?.body))).toEqual({ syncEnabled: true });
  });
});
