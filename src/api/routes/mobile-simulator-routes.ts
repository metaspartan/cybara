import {
  captureMobileSimulator,
  getMobileSimulatorStatus,
  isMobileSimulatorAction,
  type MobileSimulatorPlatform,
  runMobileSimulatorAction,
  startMobileSimulator,
  stopMobileSimulator,
} from "../../core/mobile-simulator";
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
        revision: frame.revision,
        unchanged: frame.unchanged,
        width: frame.width,
      },
    };
  },
  "POST /api/simulators/:platform/action": async (body, params) => {
    const input = inputRecord(body);
    const platform = platformFromParams(params?.platform);
    const action = optionalString(input.action);
    if (!isMobileSimulatorAction(action)) throw new Error("Invalid simulator action");
    return {
      success: true,
      data: await runMobileSimulatorAction(platform, optionalString(input.deviceId), {
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
      }),
    };
  },
};
