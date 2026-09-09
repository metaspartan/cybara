import { describe, expect, test } from "bun:test";
import {
  gatewayStartupPollInterval,
  isGatewayRecovering,
  switchToLocalGateway,
} from "../../ui/src/lib/desktopGatewayStartup";

describe("desktop gateway recovery", () => {
  test("keeps polling after the gateway first becomes ready", () => {
    expect(gatewayStartupPollInterval(true)).toBe(1_000);
    expect(gatewayStartupPollInterval(false)).toBe(false);
  });

  test("blocks the desktop surface only during a supervised recovery", () => {
    expect(
      isGatewayRecovering({
        phase: "starting",
        message: "Restarting",
        ownership: "attachedExternal",
        canSwitchToLocal: true,
      })
    ).toBe(true);
    expect(
      isGatewayRecovering({
        phase: "starting",
        message: null,
        ownership: "managedLocal",
        canSwitchToLocal: false,
      })
    ).toBe(false);
    expect(
      isGatewayRecovering({
        phase: "ready",
        message: null,
        ownership: "managedLocal",
        canSwitchToLocal: false,
      })
    ).toBe(false);
    expect(
      isGatewayRecovering({
        phase: "failed",
        message: "Stopped",
        ownership: "attachedExternal",
        canSwitchToLocal: true,
      })
    ).toBe(false);
  });

  test("exposes an explicit switch-to-local command", () => {
    expect(String(switchToLocalGateway)).toContain("switch_to_local_gateway");
    expect(String(switchToLocalGateway)).toContain("String(error)");
  });
});
