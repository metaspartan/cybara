import { describe, expect, test } from "bun:test";
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
      constants: null,
    });

    expect(result.status).toBe("permission_required");
    expect(requested).toBe(false);
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
});
