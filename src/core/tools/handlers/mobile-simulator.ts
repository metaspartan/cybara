import {
  captureMobileSimulator,
  getMobileSimulatorStatus,
  isMobileSimulatorAction,
  type MobileSimulatorPlatform,
  runMobileSimulatorAction,
  saveMobileSimulatorScreenshot,
  startMobileSimulator,
  stopMobileSimulator,
} from "../../mobile-simulator";

function simulatorPlatform(value: unknown): MobileSimulatorPlatform {
  if (value === "ios" || value === "android") return value;
  throw new Error("platform must be ios or android");
}

function optionalDeviceId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function handleMobileSimulator(args: Record<string, unknown>): Promise<unknown> {
  const action = typeof args.action === "string" ? args.action : "status";
  if (action === "status" || action === "list") return await getMobileSimulatorStatus();
  const platform = simulatorPlatform(args.platform);
  const deviceId = optionalDeviceId(args.deviceId);
  if (action === "start") {
    return { success: true, device: await startMobileSimulator(platform, deviceId) };
  }
  if (action === "stop") {
    await stopMobileSimulator(platform, deviceId);
    return { success: true };
  }
  if (action === "screenshot") {
    const saved = await saveMobileSimulatorScreenshot(platform, deviceId);
    return {
      success: true,
      ...saved,
      message: `Captured ${saved.device.name} to ${saved.filePath}`,
    };
  }
  if (action === "preview") {
    const frame = await captureMobileSimulator(platform, deviceId, undefined, "preview");
    return {
      success: true,
      device: frame.device,
      width: frame.width,
      height: frame.height,
      revision: frame.revision,
    };
  }
  if (!isMobileSimulatorAction(action)) throw new Error("Invalid simulator action");
  return await runMobileSimulatorAction(platform, deviceId, {
    action,
    x: args.x,
    y: args.y,
    endX: args.endX,
    endY: args.endY,
    durationMs: args.durationMs,
    text: args.text,
    key: args.key,
    url: args.url,
    path: args.path,
    appId: args.appId,
  });
}
