import { describe, expect, test } from "bun:test";
import {
  gatewayStartupPollInterval,
  isGatewayRecovering,
} from "../../ui/src/lib/desktopGatewayStartup";

describe("desktop gateway recovery", () => {
  test("keeps polling after the gateway first becomes ready", () => {
    expect(gatewayStartupPollInterval(true)).toBe(1_000);
    expect(gatewayStartupPollInterval(false)).toBe(false);
  });

  test("blocks the desktop surface only during a supervised recovery", () => {
    expect(isGatewayRecovering({ phase: "starting", message: "Restarting" })).toBe(true);
    expect(isGatewayRecovering({ phase: "starting", message: null })).toBe(false);
    expect(isGatewayRecovering({ phase: "ready", message: null })).toBe(false);
    expect(isGatewayRecovering({ phase: "failed", message: "Stopped" })).toBe(false);
  });
});
