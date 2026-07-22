import {
  captureMobileSimulator,
  getMobileSimulatorStatus,
  isMobileSimulatorAction,
  type MobileSimulatorPlatform,
  runMobileSimulatorAction,
  saveMobileSimulatorScreenshot,
  startMobileSimulator,
  stopMobileSimulator,
} from "../../core/mobile-simulator";
import {
  ensureIosSimulatorAutomation,
  getIosSimulatorAutomationStatus,
} from "../../core/mobile-simulator-idb";
import { recordMobileSimulatorTrajectoryTurn } from "../../core/mobile-simulator-trajectory";
import type { RouteHandler } from "./_shared";

function platformFromParams(value: unknown): MobileSimulatorPlatform {
  if (value === "ios" || value === "android") return value;
  throw new Error("Invalid simulator platform");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export const mobileSimulatorRoutes: Record<string, RouteHandler> = {
  "GET /api/simulators/status": async () => ({
    success: true,
    data: await getMobileSimulatorStatus(),
  }),
  "POST /api/simulators/ios/automation/install": async () => {
    await ensureIosSimulatorAutomation();
    return { success: true, data: getIosSimulatorAutomationStatus() };
  },
  "POST /api/simulators/:platform/start": async (body, params) => {
    const input = inputRecord(body);
    const platform = platformFromParams(params?.platform);
    return {
      success: true,
      data: await startMobileSimulator(platform, optionalString(input.deviceId)),
    };
  },
  "POST /api/simulators/:platform/stop": async (body, params) => {
    const input = inputRecord(body);
    const platform = platformFromParams(params?.platform);
    await stopMobileSimulator(platform, optionalString(input.deviceId));
    return { success: true };
  },
  "GET /api/simulators/:platform/screenshot": async (_body, params) => {
    const platform = platformFromParams(params?.platform);
    const frame = await captureMobileSimulator(
      platform,
      optionalString(params?.deviceId),
      optionalString(params?.revision),
      "preview"
    );
    return {
      success: true,
      data: {
        ...(frame.bytes ? { screenshot: frame.bytes.toString("base64") } : {}),
        contentType: frame.contentType,
        device: frame.device,
        height: frame.height,
        interaction: frame.interaction,
        revision: frame.revision,
        sourceHeight: frame.sourceHeight,
        sourceWidth: frame.sourceWidth,
        unchanged: frame.unchanged,
        width: frame.width,
      },
    };
  },
  "POST /api/simulators/:platform/screenshot": async (body, params) => {
    const input = inputRecord(body);
    const platform = platformFromParams(params?.platform);
    return {
      success: true,
      data: await saveMobileSimulatorScreenshot(platform, optionalString(input.deviceId)),
    };
  },
  "POST /api/simulators/:platform/action": async (body, params) => {
    const input = inputRecord(body);
    const platform = platformFromParams(params?.platform);
    const action = optionalString(input.action);
    if (!isMobileSimulatorAction(action)) throw new Error("Invalid simulator action");
    const deviceId = optionalString(input.deviceId);
    const actionInput = {
      action,
      x: input.x,
      y: input.y,
      endX: input.endX,
      endY: input.endY,
      durationMs: input.durationMs,
      text: input.text,
      key: input.key,
      url: input.url,
      path: input.path,
      appId: input.appId,
    };
    const result = await runMobileSimulatorAction(platform, deviceId, actionInput, {
      source: "user",
    });
    await recordMobileSimulatorTrajectoryTurn({
      action: actionInput,
      deviceId,
      platform,
      result,
      sessionId: optionalString(input.sessionId),
    }).catch(() => undefined);
    return { success: true, data: result };
  },
};
