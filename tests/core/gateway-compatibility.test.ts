import { describe, expect, test } from "bun:test";
import {
  gatewayApiDecision,
  readGatewayApiCompatibility,
} from "../../shared/gateway-compatibility";

describe("gateway API compatibility", () => {
  test("accepts exact, older-client, and newer-client release numbers when API versions match", () => {
    const contract = readGatewayApiCompatibility({
      api_version: 1,
      min_client_api_version: 1,
    });
    expect(gatewayApiDecision(contract, 1)).toEqual({ compatible: true });
  });

  test("requires a client update when the gateway raises its minimum API version", () => {
    expect(gatewayApiDecision({ api_version: 2, min_client_api_version: 2 }, 1)).toEqual({
      compatible: false,
      reason: "Gateway API requires client API 2 or newer; this client supports API 1.",
    });
  });

  test("requires a gateway update when the client API is newer", () => {
    expect(gatewayApiDecision({ api_version: 1, min_client_api_version: 1 }, 2)).toEqual({
      compatible: false,
      reason: "This client requires gateway API 2; the gateway supports API 1.",
    });
  });

  test("supports legacy gateways and rejects malformed declared contracts", () => {
    expect(gatewayApiDecision(null, 1)).toEqual({ compatible: true });
    expect(readGatewayApiCompatibility({ api_version: 1 })).toBeNull();
    expect(readGatewayApiCompatibility({ api_version: "1", min_client_api_version: 1 })).toBeNull();
    expect(readGatewayApiCompatibility({ api_version: 0, min_client_api_version: 1 })).toBeNull();
  });
});
