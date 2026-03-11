export type DesktopHostRuntime = 'tauri' | 'cybara-native' | null;

type DesktopNotificationPermission = NotificationPermission;

type CybaraNativeDesktopBridge = {
  runtime: 'cybara-native';
  platform: 'macos';
  bridgeVersion: number;
  gatewayPort: number;
  managedGateway: boolean;
  supportsDesktopUpdater: boolean;
  openExternal?: (url: string) => void;
  notify?: (payload: { title: string; body?: string }) => void;
  openDirectoryDialog?: (options?: {
    defaultPath?: string;
    title?: string;
  }) => Promise<string | null>;
  requestNotificationPermission?: () => Promise<DesktopNotificationPermission>;
  notificationPermission?: () => Promise<DesktopNotificationPermission>;
};

declare global {
  interface Window {
    __CYBARA_NATIVE__?: CybaraNativeDesktopBridge;
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriDesktopRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export function isCybaraNativeRuntime(): boolean {
  return typeof window !== 'undefined' && window.__CYBARA_NATIVE__?.runtime === 'cybara-native';
}

export function getDesktopHostRuntime(): DesktopHostRuntime {
  if (isTauriDesktopRuntime()) return 'tauri';
  if (isCybaraNativeRuntime()) return 'cybara-native';
  return null;
}

export function isDesktopHostRuntime(): boolean {
  return getDesktopHostRuntime() !== null;
}

export function isDesktopUpdaterSupported(): boolean {
  return getDesktopHostRuntime() === 'tauri';
}

export function getDesktopRuntimeLabel(runtime = getDesktopHostRuntime()): string {
  if (runtime === 'tauri') return 'Tauri Desktop';
  if (runtime === 'cybara-native') return 'Cybara macOS App';
  return 'Web';
}

export async function getDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (isTauriDesktopRuntime()) {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
    const granted = await isPermissionGranted();
    return granted ? 'granted' : 'default';
  }

  if (isCybaraNativeRuntime() && window.__CYBARA_NATIVE__?.notificationPermission) {
    return window.__CYBARA_NATIVE__.notificationPermission();
  }

  if (typeof Notification === 'undefined') {
    return 'denied';
  }

  return Notification.permission;
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (isTauriDesktopRuntime()) {
    const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === 'granted';
    }
    return granted ? 'granted' : 'denied';
  }

  if (isCybaraNativeRuntime() && window.__CYBARA_NATIVE__?.requestNotificationPermission) {
    return window.__CYBARA_NATIVE__.requestNotificationPermission();
  }

  if (typeof Notification === 'undefined') {
    return 'denied';
  }

  return Notification.requestPermission();
}

export async function sendDesktopNotification(
  title: string,
  options?: NotificationOptions
): Promise<Notification | null> {
  if (isTauriDesktopRuntime()) {
    const permission = await requestDesktopNotificationPermission();
    if (permission !== 'granted') return null;
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    await sendNotification({ title, body: options?.body || '' });
    return null;
  }

  if (isCybaraNativeRuntime() && window.__CYBARA_NATIVE__?.notify) {
    window.__CYBARA_NATIVE__.notify({ title, body: options?.body });
    return null;
  }

  if (typeof Notification === 'undefined') {
    return null;
  }

  const permission = await requestDesktopNotificationPermission();
  if (permission !== 'granted') {
    return null;
  }

  return new Notification(title, {
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    ...options,
  });
}

export async function openDesktopDirectoryDialog(options?: {
  defaultPath?: string;
  title?: string;
}): Promise<string | null> {
  if (isTauriDesktopRuntime()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: options?.defaultPath,
      title: options?.title,
    });

    if (typeof selected === 'string' && selected.trim()) {
      return selected.trim();
    }

    if (Array.isArray(selected)) {
      const first = selected.find(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
      );
      if (first) {
        return first.trim();
      }
    }

    return null;
  }

  if (isCybaraNativeRuntime() && window.__CYBARA_NATIVE__?.openDirectoryDialog) {
    return window.__CYBARA_NATIVE__.openDirectoryDialog(options);
  }

  return null;
}
