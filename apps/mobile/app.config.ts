import type { ConfigContext, ExpoConfig } from "expo/config";
import app from "./app.json";

function environmentValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export default function mobileAppConfig(_context: ConfigContext): ExpoConfig {
  const base = app.expo as ExpoConfig;
  const projectId = environmentValue("EXPO_PROJECT_ID", "EXPO_PUBLIC_EAS_PROJECT_ID");
  const googleServicesFile = environmentValue(
    "FIREBASE_GOOGLE_SERVICES_FILE",
    "GOOGLE_SERVICES_FILE"
  );

  return {
    ...base,
    android: {
      ...base.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    extra: {
      ...base.extra,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
}
