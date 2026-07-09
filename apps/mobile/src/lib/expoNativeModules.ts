import type { ComponentType, PropsWithChildren } from "react";

type PermissionResponse = { granted: boolean; status: "denied" | "undetermined" | "granted" };
type ImagePickerAsset = { base64?: string | null; mimeType?: string | null };
type ImagePickerResult =
  | { canceled: true; assets: ImagePickerAsset[] }
  | { canceled: false; assets: ImagePickerAsset[] };

const deniedPermission: PermissionResponse = { granted: false, status: "denied" };

export const Camera = {
  getCameraPermissionsAsync: async () => deniedPermission,
  requestCameraPermissionsAsync: async () => deniedPermission,
};

export const CameraView = (() => null) as ComponentType<Record<string, unknown>>;

export const Clipboard = {
  hasImageAsync: async () => false,
  getImageAsync: async (_options?: Record<string, unknown>) => null as { data: string } | null,
  getStringAsync: async () => "",
  setStringAsync: async (_value: string) => true,
};

export const Constants = {
  executionEnvironment: "test",
  appOwnership: null,
};

export const GlassView = ((props: PropsWithChildren<Record<string, unknown>>) =>
  props.children ?? null) as ComponentType<PropsWithChildren<Record<string, unknown>>>;

export const GlassContainer = GlassView;

export const ImagePicker = {
  requestMediaLibraryPermissionsAsync: async () => deniedPermission,
  launchImageLibraryAsync: async (
    _options?: Record<string, unknown>
  ): Promise<ImagePickerResult> => ({
    canceled: true,
    assets: [],
  }),
};

export const Notifications = {
  getPermissionsAsync: async () => ({ status: "denied" }),
  requestPermissionsAsync: async () => ({ status: "denied" }),
  getExpoPushTokenAsync: async () => ({ data: "" }),
};

export const Platform = {
  OS: "test",
  Version: "0",
};

export const SecureStore = {};

export function isGlassEffectAPIAvailable(): boolean {
  return false;
}

export function isLiquidGlassAvailable(): boolean {
  return false;
}
