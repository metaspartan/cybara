import { isLocalNetworkGatewayUrl } from "./connection";

export type AndroidLanPermissionName = "android.permission.NEARBY_WIFI_DEVICES";

export interface AndroidLanAccessRuntime {
  os: string;
  apiLevel: number;
  grantedStatus: string;
  check(permission: AndroidLanPermissionName): Promise<boolean>;
  request(permission: AndroidLanPermissionName): Promise<string>;
}

export function androidLanPermissionForApiLevel(apiLevel: number): AndroidLanPermissionName | null {
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
    throw new Error(
      "Local network access is required for this gateway. Allow Nearby devices for Cybara in Android Settings, then try again."
    );
  }
}
