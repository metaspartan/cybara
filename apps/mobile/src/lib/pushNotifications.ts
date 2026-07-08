import type { CybaraMobileApi } from "./api";

type PermissionStatus = "granted" | "denied" | "undetermined" | string;

interface NotificationsLike {
  getPermissionsAsync: () => Promise<{ status: PermissionStatus }>;
  requestPermissionsAsync: () => Promise<{ status: PermissionStatus }>;
  getExpoPushTokenAsync: (options?: { projectId?: string }) => Promise<{ data: string }>;
  setNotificationHandler?: (handler: unknown) => void;
}

interface ConstantsLike {
  expoConfig?: {
    extra?: Record<string, unknown>;
  };
  easConfig?: {
    projectId?: string;
  };
  executionEnvironment?: string;
  appOwnership?: string | null;
}

export interface MobilePushRegistrationResult {
  status: "registered" | "permission_required" | "denied" | "unavailable" | "failed" | "cleared";
  token?: string;
  message?: string;
}

export interface MobilePushRegistrationOptions {
  requestPermission?: boolean;
  platform?: string;
  notifications?: NotificationsLike | null;
  constants?: ConstantsLike | null;
}

async function loadNotifications(): Promise<NotificationsLike | null> {
  try {
    const mod = await import("expo-notifications");
    return mod as unknown as NotificationsLike;
  } catch {
    return null;
  }
}

async function loadConstants(): Promise<ConstantsLike | null> {
  try {
    const mod = await import("expo-constants");
    return ((mod as { default?: ConstantsLike }).default ?? mod) as ConstantsLike;
  } catch {
    return null;
  }
}

async function isExpoGoRuntime(constants?: ConstantsLike | null): Promise<boolean> {
  const resolved = constants === undefined ? await loadConstants() : constants;
  return resolved?.executionEnvironment === "storeClient" || resolved?.appOwnership === "expo";
}

async function loadNativePlatform(): Promise<string> {
  try {
    const mod = await import("react-native");
    return (mod as { Platform?: { OS?: string } }).Platform?.OS || "unknown";
  } catch {
    return "unknown";
  }
}

function expoProjectId(constants: ConstantsLike | null | undefined): string | undefined {
  const extra = constants?.expoConfig?.extra;
  const easProjectId = constants?.easConfig?.projectId;
  const extraProjectId =
    extra?.eas && typeof extra.eas === "object"
      ? (extra.eas as Record<string, unknown>).projectId
      : extra?.expoProjectId;
  return typeof easProjectId === "string"
    ? easProjectId
    : typeof extraProjectId === "string"
      ? extraProjectId
      : undefined;
}

function nativePushPlatform(platform: string): "ios" | "android" | null {
  return platform === "ios" || platform === "android" ? platform : null;
}

export async function configureMobileNotificationPresentation(
  options: MobilePushRegistrationOptions = {}
): Promise<boolean> {
  if (options.notifications === undefined && (await isExpoGoRuntime(options.constants))) {
    return false;
  }
  const notifications =
    options.notifications === undefined ? await loadNotifications() : options.notifications;
  if (!notifications?.setNotificationHandler) return false;
  try {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function registerMobilePushNotifications(
  api: CybaraMobileApi,
  options: MobilePushRegistrationOptions = {}
): Promise<MobilePushRegistrationResult> {
  if (options.notifications === undefined && (await isExpoGoRuntime(options.constants))) {
    return {
      status: "unavailable",
      message: "Push notifications require a development build (not Expo Go).",
    };
  }

  const platform = nativePushPlatform(options.platform ?? (await loadNativePlatform()));
  if (!platform)
    return { status: "unavailable", message: "Push notifications require iOS or Android." };

  const notifications =
    options.notifications === undefined ? await loadNotifications() : options.notifications;
  if (!notifications) {
    return { status: "unavailable", message: "Expo notifications are unavailable." };
  }

  const current = await notifications.getPermissionsAsync();
  let permission = current.status;
  if (permission !== "granted") {
    if (options.requestPermission === false) {
      return { status: "permission_required", message: "Notification permission is not enabled." };
    }
    permission = (await notifications.requestPermissionsAsync()).status;
  }

  if (permission !== "granted") {
    return { status: "denied", message: "Notification permission was denied." };
  }

  try {
    const constants = options.constants === undefined ? await loadConstants() : options.constants;
    const projectId = expoProjectId(constants);
    const token = (await notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined))
      .data;
    await api.registerPushToken({ token, provider: "expo", platform });
    return { status: "registered", token };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function clearMobilePushNotifications(
  api: CybaraMobileApi
): Promise<MobilePushRegistrationResult> {
  await api.clearPushToken();
  return { status: "cleared" };
}
