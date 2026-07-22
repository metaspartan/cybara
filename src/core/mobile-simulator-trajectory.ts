import { recordVisualInteractionTrajectoryTurn } from "./computer-use";
import {
  captureMobileSimulator,
  type MobileSimulatorAction,
  type MobileSimulatorPlatform,
} from "./mobile-simulator";

function clickPoint(input: MobileSimulatorAction): { x: number; y: number } | undefined {
  const x = Number(input.x);
  const y = Number(input.y);
  return input.action === "tap" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

export async function recordMobileSimulatorTrajectoryTurn(input: {
  action: MobileSimulatorAction;
  deviceId?: string;
  platform: MobileSimulatorPlatform;
  result: unknown;
  sessionId?: string;
}): Promise<boolean> {
  return recordVisualInteractionTrajectoryTurn({
    arguments: {
      ...input.action,
      deviceId: input.deviceId,
      platform: input.platform,
    },
    captureAfter: async () => {
      const frame = await captureMobileSimulator(
        input.platform,
        input.deviceId,
        undefined,
        "preview"
      );
      return {
        screenshot: frame.bytes?.toString("base64"),
        screenshotMime: frame.contentType,
      };
    },
    clickPoint: clickPoint(input.action),
    result: input.result,
    sessionId: input.sessionId,
    surface: input.platform === "ios" ? "ios_simulator" : "android_emulator",
    tool: "mobile_simulator",
  });
}
