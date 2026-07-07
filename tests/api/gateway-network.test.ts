import { afterEach, describe, expect, test } from "bun:test";
import {
  normalizeGatewayBindHost,
  requestGatewayHostApply,
  setGatewayHostApplyHandler,
} from "../../src/api/gateway-network";

describe("gateway network settings", () => {
  afterEach(() => {
    setGatewayHostApplyHandler(null);
  });

  test("normalizes safe bind hosts and rejects URLs", () => {
    expect(normalizeGatewayBindHost(" 0.0.0.0 ")).toBe("0.0.0.0");
    expect(normalizeGatewayBindHost("LOCALHOST")).toBe("localhost");
    expect(normalizeGatewayBindHost("192.168.50.116")).toBe("192.168.50.116");
    expect(normalizeGatewayBindHost("gateway.local")).toBe("gateway.local");
    expect(() => normalizeGatewayBindHost("http://192.168.50.116:4269")).toThrow("not a URL");
  });

  test("schedules host apply through the registered runtime handler", () => {
    const requested: string[] = [];
    setGatewayHostApplyHandler((host) => {
      requested.push(host);
    });

    expect(requestGatewayHostApply("0.0.0.0")).toEqual({ scheduled: true });
    expect(requested).toEqual(["0.0.0.0"]);
  });

  test("reports unavailable runtime apply handler", () => {
    expect(requestGatewayHostApply("0.0.0.0")).toMatchObject({ scheduled: false });
  });
});
