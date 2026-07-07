import { afterEach, describe, expect, test } from "bun:test";
import {
  normalizeGatewayBindHost,
  requestGatewayHostApply,
  setGatewayHostApplyHandler,
  updateGatewayHostSetting,
} from "../../src/api/gateway-network";
import { config } from "../../src/core/config";

const originalCybaraHost = process.env.CYBARA_HOST;

describe("gateway network settings", () => {
  afterEach(() => {
    setGatewayHostApplyHandler(null);
    config.set("host", "127.0.0.1");
    if (originalCybaraHost === undefined) delete process.env.CYBARA_HOST;
    else process.env.CYBARA_HOST = originalCybaraHost;
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

  test("allows Settings to rebind the running gateway even when launched with CYBARA_HOST", () => {
    const requested: string[] = [];
    process.env.CYBARA_HOST = "127.0.0.1";
    setGatewayHostApplyHandler((host) => {
      requested.push(host);
    });

    expect(updateGatewayHostSetting("0.0.0.0", true)).toEqual({ hostApplyScheduled: true });
    expect(config.get("host")).toBe("0.0.0.0");
    expect(requested).toEqual(["0.0.0.0"]);
  });
});
