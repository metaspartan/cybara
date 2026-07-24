import type { CybaraMobileApi } from "./api";
import { Constants, Notifications, Platform } from "./expoNativeModules";

type PermissionStatus = "granted" | "denied" | "undetermined" | string;

interface NotificationsLike {
  AndroidImportance?: {
    HIGH?: number;
    MAX?: number;
  };
  getPermissionsAsync: () => Promise<{ status: PermissionStatus }>;
  requestPermissionsAsync: () => Promise<{ status: PermissionStatus }>;
  getExpoPushTokenAsync: (options?: { projectId?: string }) => Promise<{ data: string }>;
  setNotificationChannelAsync?: (
    channelId: string,
    channel: {
      description: string;
      importance: number;
      lightColor: string;
      name: string;
      showBadge: boolean;
      vibrationPattern: number[];
    }
  ) => Promise<unknown>;
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

function defaultNotifications(): NotificationsLike {
  return Notifications as unknown as NotificationsLike;
}

function defaultConstants(): ConstantsLike {
  return Constants as ConstantsLike;
}

function isExpoGoRuntime(constants?: ConstantsLike | null): boolean {
  const resolved = constants === undefined ? defaultConstants() : constants;
  return resolved?.executionEnvironment === "storeClient" || resolved?.appOwnership === "expo";
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

function mobilePushBuildIssue(constants: ConstantsLike | null | undefined): string | null {
  if (!expoProjectId(constants)) {
    return "This app build is missing its Expo project ID. Install a notification-enabled Cybara build.";
  }
  return null;
}

function mobilePushRegistrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("firebaseapp") ||
    normalized.includes("firebase app") ||
    normalized.includes("default firebase")
  ) {
    return "This Android build is not registered with Firebase. Install a notification-enabled Cybara build.";
  }
  if (normalized.includes("project id") || normalized.includes("projectid")) {
    return "This app build is missing its Expo project ID. Install a notification-enabled Cybara build.";
  }
  if (normalized.includes("aps-environment") || normalized.includes("apns")) {
    return "This iOS build is missing valid push notification credentials. Install a notification-enabled Cybara build.";
  }
  return message;
}

async function configureAndroidNotificationChannel(
  notifications: NotificationsLike,
  platform: "ios" | "android"
): Promise<void> {
  if (platform !== "android" || !notifications.setNotificationChannelAsync) return;
  const importance =
    notifications.AndroidImportance?.MAX ?? notifications.AndroidImportance?.HIGH ?? 4;
  await notifications.setNotificationChannelAsync("cybara", {
    description: "Chat and task completion notifications",
    importance,
    lightColor: "#f97316",
    name: "Cybara activity",
    showBadge: true,
    vibrationPattern: [0, 200, 100, 200],
  });
}

export async function configureMobileNotificationPresentation(
  options: MobilePushRegistrationOptions = {}
): Promise<boolean> {
  if (options.notifications === undefined && isExpoGoRuntime(options.constants)) {
    return false;
  }
  const notifications =
    options.notifications === undefined ? defaultNotifications() : options.notifications;
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
  if (options.notifications === undefined && isExpoGoRuntime(options.constants)) {
    return {
      status: "unavailable",
      message: "Push notifications require a development build (not Expo Go).",
    };
  }

  const platform = nativePushPlatform(options.platform ?? Platform.OS);
  if (!platform)
    return { status: "unavailable", message: "Push notifications require iOS or Android." };

  const notifications =
    options.notifications === undefined ? defaultNotifications() : options.notifications;
  if (!notifications) {
    return { status: "unavailable", message: "Expo notifications are unavailable." };
  }

  try {
    const constants = options.constants === undefined ? defaultConstants() : options.constants;
    const buildIssue = mobilePushBuildIssue(constants);
    if (buildIssue) return { status: "failed", message: buildIssue };

    await configureAndroidNotificationChannel(notifications, platform);
    const current = await notifications.getPermissionsAsync();
    let permission = current.status;
    if (permission !== "granted") {
      if (options.requestPermission === false) {
        return {
          status: "permission_required",
          message: "Notification permission is not enabled.",
        };
      }
      permission = (await notifications.requestPermissionsAsync()).status;
    }

    if (permission !== "granted") {
      return { status: "denied", message: "Notification permission was denied." };
    }

    const projectId = expoProjectId(constants);
    const token = (await notifications.getExpoPushTokenAsync({ projectId })).data;
    await api.registerPushToken({ token, provider: "expo", platform });
    return { status: "registered", token };
  } catch (error) {
    return {
      status: "failed",
      message: mobilePushRegistrationError(error),
    };
  }
}

export async function clearMobilePushNotifications(
  api: CybaraMobileApi
): Promise<MobilePushRegistrationResult> {
  await api.clearPushToken();
  return { status: "cleared" };
}
