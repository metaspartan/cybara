import { describe, expect, test } from "bun:test";
import {
  androidLanPermissionForApiLevel,
  ensureAndroidLanAccess,
  type AndroidLanAccessRuntime,
  type AndroidLanPermissionName,
} from "../../apps/mobile/src/lib/androidLanAccess";

function createRuntime(input: {
  os?: string;
  apiLevel: number;
  checked?: boolean;
  requestStatus?: string;
}): { runtime: AndroidLanAccessRuntime; checks: string[]; requests: string[] } {
  const checks: string[] = [];
  const requests: string[] = [];
  return {
    checks,
    requests,
    runtime: {
      os: input.os ?? "android",
      apiLevel: input.apiLevel,
      grantedStatus: "granted",
      check: async (permission: AndroidLanPermissionName) => {
        checks.push(permission);
        return input.checked ?? false;
      },
      request: async (permission: AndroidLanPermissionName) => {
        requests.push(permission);
        return input.requestStatus ?? "granted";
      },
    },
  };
}

describe("Android local network access", () => {
  test("selects the Android 16 permission contract for the current target SDK", () => {
    expect(androidLanPermissionForApiLevel(35)).toBeNull();
    expect(androidLanPermissionForApiLevel(36)).toBe("android.permission.NEARBY_WIFI_DEVICES");
    expect(androidLanPermissionForApiLevel(37)).toBeNull();
  });

  test("requests Android 16 LAN access before using a private gateway", async () => {
    const state = createRuntime({ apiLevel: 36 });
    await ensureAndroidLanAccess("http://192.168.1.123:4269", state.runtime);
    expect(state.checks).toEqual(["android.permission.NEARBY_WIFI_DEVICES"]);
    expect(state.requests).toEqual(["android.permission.NEARBY_WIFI_DEVICES"]);
  });

  test("does not request access for public, old, target-36-on-Android-17, or iOS gateways", async () => {
    const publicState = createRuntime({ apiLevel: 37 });
    const oldState = createRuntime({ apiLevel: 35 });
    const android17State = createRuntime({ apiLevel: 37 });
    const iosState = createRuntime({ os: "ios", apiLevel: 37 });
    await ensureAndroidLanAccess("https://cybara.example.com", publicState.runtime);
    await ensureAndroidLanAccess("http://192.168.1.123:4269", oldState.runtime);
    await ensureAndroidLanAccess("http://192.168.1.123:4269", android17State.runtime);
    await ensureAndroidLanAccess("http://192.168.1.123:4269", iosState.runtime);
    expect(publicState.checks).toHaveLength(0);
    expect(oldState.checks).toHaveLength(0);
    expect(android17State.checks).toHaveLength(0);
    expect(iosState.checks).toHaveLength(0);
  });

  test("fails with an actionable error when permission is denied", async () => {
    const state = createRuntime({ apiLevel: 36, requestStatus: "denied" });
    await expect(
      ensureAndroidLanAccess("http://192.168.1.123:4269", state.runtime)
    ).rejects.toThrow("Allow Nearby devices");
  });
});
