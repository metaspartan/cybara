import { isLocalNetworkGatewayUrl } from "./connection";

export type AndroidLanPermissionName =
  | "android.permission.ACCESS_LOCAL_NETWORK"
  | "android.permission.NEARBY_WIFI_DEVICES";

export interface AndroidLanAccessRuntime {
  os: string;
  apiLevel: number;
  grantedStatus: string;
  check(permission: AndroidLanPermissionName): Promise<boolean>;
  request(permission: AndroidLanPermissionName): Promise<string>;
}

export function androidLanPermissionForApiLevel(apiLevel: number): AndroidLanPermissionName | null {
  if (apiLevel >= 37) return "android.permission.ACCESS_LOCAL_NETWORK";
  if (apiLevel === 36) return "android.permission.NEARBY_WIFI_DEVICES";
  return null;
}

export async function ensureAndroidLanAccess(
  baseUrl: string,
  runtime: AndroidLanAccessRuntime
): Promise<void> {
  if (runtime.os !== "android" || !isLocalNetworkGatewayUrl(baseUrl)) return;
  const permission = androidLanPermissionForApiLevel(runtime.apiLevel);
  if (!permission || (await runtime.check(permission))) return;
  const status = await runtime.request(permission);
  if (status !== runtime.grantedStatus) {
    const settingName =
      permission === "android.permission.ACCESS_LOCAL_NETWORK" ? "Local network" : "Nearby devices";
    throw new Error(
      `Local network access is required for this gateway. Allow ${settingName} for Cybara in Android Settings, then try again.`
    );
  }
}
