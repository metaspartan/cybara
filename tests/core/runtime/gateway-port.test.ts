import { describe, expect, test } from "bun:test";
import {
  gatewayPortCandidates,
  gatewayPortFallbackCount,
  gatewayPortSignal,
} from "../../../src/core/runtime/gateway-port";

describe("gateway port selection", () => {
  test("builds a bounded sequence of candidate ports", () => {
    expect(gatewayPortCandidates(4269, 3)).toEqual([4269, 4270, 4271, 4272]);
    expect(gatewayPortCandidates(65534, 4)).toEqual([65534, 65535]);
    expect(gatewayPortCandidates(4269, -1)).toEqual([4269]);
  });

  test("normalizes fallback counts from the environment", () => {
    expect(gatewayPortFallbackCount(undefined)).toBe(0);
    expect(gatewayPortFallbackCount("10")).toBe(10);
    expect(gatewayPortFallbackCount("200")).toBe(100);
    expect(gatewayPortFallbackCount("invalid")).toBe(0);
  });

  test("formats the desktop startup signal", () => {
    expect(gatewayPortSignal(4271)).toBe("CYBARA_GATEWAY_PORT=4271");
  });
});
