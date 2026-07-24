import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CybaraMobileApi } from "../../apps/mobile/src/lib/api";
import {
  clearMobilePushNotifications,
  configureMobileNotificationPresentation,
  registerMobilePushNotifications,
} from "../../apps/mobile/src/lib/pushNotifications";

function createApi() {
  const calls: unknown[] = [];
  const api = {
    registerPushToken: async (input: unknown) => {
      calls.push({ method: "register", input });
      return { success: true };
    },
    clearPushToken: async () => {
      calls.push({ method: "clear" });
      return { success: true };
    },
  } as unknown as CybaraMobileApi;
  return { api, calls };
}

const pushBuildConstants = {
  easConfig: { projectId: "project-123" },
};

describe("mobile push notification helpers", () => {
  test("registers an Expo token after permission is granted", async () => {
    const { api, calls } = createApi();
    const tokenOptions: unknown[] = [];
    const notifications = {
      getPermissionsAsync: async () => ({ status: "undetermined" }),
      requestPermissionsAsync: async () => ({ status: "granted" }),
      getExpoPushTokenAsync: async (options?: { projectId?: string }) => {
        tokenOptions.push(options);
        return { data: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]" };
      },
    };

    const result = await registerMobilePushNotifications(api, {
      platform: "ios",
      notifications,
      constants: { easConfig: { projectId: "project-123" } },
    });

    expect(result).toMatchObject({
      status: "registered",
      token: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]",
    });
    expect(tokenOptions).toEqual([{ projectId: "project-123" }]);
    expect(calls).toEqual([
      {
        method: "register",
        input: {
          token: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]",
          provider: "expo",
          platform: "ios",
        },
      },
    ]);
  });

  test("does not prompt when silent registration is requested", async () => {
    const { api, calls } = createApi();
    let requested = false;
    const result = await registerMobilePushNotifications(api, {
      platform: "android",
      requestPermission: false,
      notifications: {
        getPermissionsAsync: async () => ({ status: "undetermined" }),
        requestPermissionsAsync: async () => {
          requested = true;
          return { status: "granted" };
        },
        getExpoPushTokenAsync: async () => ({ data: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]" }),
      },
      constants: pushBuildConstants,
    });

    expect(result.status).toBe("permission_required");
    expect(requested).toBe(false);
    expect(calls).toEqual([]);
  });

  test("creates the Android notification channel before requesting permission", async () => {
    const { api, calls } = createApi();
    const channelCalls: unknown[] = [];
    const result = await registerMobilePushNotifications(api, {
      platform: "android",
      notifications: {
        AndroidImportance: { MAX: 5 },
        getPermissionsAsync: async () => ({ status: "granted" }),
        requestPermissionsAsync: async () => ({ status: "granted" }),
        getExpoPushTokenAsync: async () => ({ data: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]" }),
        setNotificationChannelAsync: async (channelId, channel) => {
          channelCalls.push({ channelId, channel });
        },
      },
      constants: pushBuildConstants,
    });

    expect(result.status).toBe("registered");
    expect(channelCalls).toEqual([
      {
        channelId: "cybara",
        channel: expect.objectContaining({ importance: 5, name: "Cybara activity" }),
      },
    ]);
    expect(calls).toHaveLength(1);
  });

  test("fails clearly before native registration when build metadata is missing", async () => {
    const { api, calls } = createApi();
    let permissionRead = false;
    const result = await registerMobilePushNotifications(api, {
      platform: "android",
      notifications: {
        getPermissionsAsync: async () => {
          permissionRead = true;
          return { status: "granted" };
        },
        requestPermissionsAsync: async () => ({ status: "granted" }),
        getExpoPushTokenAsync: async () => ({ data: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]" }),
      },
      constants: null,
    });

    expect(result).toEqual({
      status: "failed",
      message:
        "This app build is missing its Expo project ID. Install a notification-enabled Cybara build.",
    });
    expect(permissionRead).toBe(false);
    expect(calls).toEqual([]);
  });

  test("replaces raw Firebase initialization failures with an actionable build error", async () => {
    const { api, calls } = createApi();
    const result = await registerMobilePushNotifications(api, {
      platform: "android",
      notifications: {
        getPermissionsAsync: async () => ({ status: "granted" }),
        requestPermissionsAsync: async () => ({ status: "granted" }),
        getExpoPushTokenAsync: async () => {
          throw new Error("No Firebase App '[DEFAULT]' has been created");
        },
      },
      constants: pushBuildConstants,
    });

    expect(result).toEqual({
      status: "failed",
      message:
        "This Android build is not registered with Firebase. Install a notification-enabled Cybara build.",
    });
    expect(calls).toEqual([]);
  });

  test("configures foreground notification presentation and clears registration", async () => {
    const { api, calls } = createApi();
    let handler: unknown = null;
    const configured = await configureMobileNotificationPresentation({
      notifications: {
        getPermissionsAsync: async () => ({ status: "granted" }),
        requestPermissionsAsync: async () => ({ status: "granted" }),
        getExpoPushTokenAsync: async () => ({ data: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]" }),
        setNotificationHandler: (next: unknown) => {
          handler = next;
        },
      },
    });

    await expect(clearMobilePushNotifications(api)).resolves.toEqual({ status: "cleared" });
    expect(configured).toBe(true);
    expect(handler).toBeTruthy();
    expect(calls).toEqual([{ method: "clear" }]);
  });

  test("notification presentation setup is non-fatal when the native module rejects", async () => {
    const configured = await configureMobileNotificationPresentation({
      notifications: {
        getPermissionsAsync: async () => ({ status: "granted" }),
        requestPermissionsAsync: async () => ({ status: "granted" }),
        getExpoPushTokenAsync: async () => ({ data: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]" }),
        setNotificationHandler: () => {
          throw new Error("native notification handler unavailable");
        },
      },
    });

    expect(configured).toBe(false);
  });

  test("native and release configuration require notification credentials", () => {
    const mobileRoot = fileURLToPath(new URL("../../apps/mobile/", import.meta.url));
    const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
    const appJson = JSON.parse(readFileSync(`${mobileRoot}/app.json`, "utf8"));
    const appConfig = readFileSync(`${mobileRoot}/app.config.ts`, "utf8");
    const releaseWorkflow = readFileSync(`${repositoryRoot}/.github/workflows/release.yml`, "utf8");

    expect(appJson.expo.ios.entitlements["aps-environment"]).toBe("development");
    expect(appJson.expo.android.permissions).toContain("android.permission.POST_NOTIFICATIONS");
    expect(appConfig).toContain('"EXPO_PROJECT_ID"');
    expect(appConfig).toContain('"FIREBASE_GOOGLE_SERVICES_FILE"');
    expect(releaseWorkflow).toContain("FIREBASE_GOOGLE_SERVICES_JSON_BASE64");
    expect(releaseWorkflow).toContain(
      "The iOS provisioning profile must include the aps-environment entitlement"
    );
    expect(releaseWorkflow).not.toContain("Delete :aps-environment");
  });
});
