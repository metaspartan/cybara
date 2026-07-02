import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GatewayProfile } from "./connection";

const PROFILE_KEY = "cybara.mobile.gatewayProfiles";
const ACTIVE_KEY = "cybara.mobile.activeGatewayId";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Load expo-secure-store lazily: it's a native module, so a static import would
// break in non-RN contexts (tests) and would eval before the dev client is
// rebuilt. Resolves to null when unavailable so callers fall back gracefully.
type SecureStoreModule = typeof import("expo-secure-store");
let secureStorePromise: Promise<SecureStoreModule | null> | null = null;
function loadSecureStore(): Promise<SecureStoreModule | null> {
  if (!secureStorePromise) {
    secureStorePromise = import("expo-secure-store").catch(() => null);
  }
  return secureStorePromise;
}

// The gateway profile contains the API bearer token, so it lives in the OS
// secure enclave (iOS Keychain / Android Keystore) via expo-secure-store rather
// than plaintext AsyncStorage. Falls back to AsyncStorage when SecureStore is
// unavailable (e.g. a dev client not yet rebuilt), and transparently migrates
// any pre-existing plaintext value into the secure store on first read.
const secureStorage: KeyValueStorage = {
  async getItem(key) {
    const store = await loadSecureStore();
    if (store) {
      try {
        const secure = await store.getItemAsync(key);
        if (secure !== null) return secure;
      } catch {
        // fall through to AsyncStorage
      }
    }
    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null && store) {
      try {
        await store.setItemAsync(key, legacy);
        await AsyncStorage.removeItem(key);
      } catch {
        // keep the legacy copy if migration isn't possible yet
      }
    }
    return legacy;
  },
  async setItem(key, value) {
    const store = await loadSecureStore();
    if (store) {
      try {
        await store.setItemAsync(key, value);
        return;
      } catch {
        // fall through to AsyncStorage
      }
    }
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key) {
    const store = await loadSecureStore();
    if (store) {
      try {
        await store.deleteItemAsync(key);
      } catch {
        // ignore
      }
    }
    await AsyncStorage.removeItem(key);
  },
};

const defaultStorage: KeyValueStorage = secureStorage;

export async function loadProfiles(
  storage: KeyValueStorage = defaultStorage
): Promise<GatewayProfile[]> {
  const raw = await storage.getItem(PROFILE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is GatewayProfile =>
          Boolean(item?.id && item?.baseUrl && item?.apiKey)
        )
      : [];
  } catch {
    return [];
  }
}

export async function saveProfile(
  profile: GatewayProfile,
  storage: KeyValueStorage = defaultStorage
): Promise<GatewayProfile[]> {
  const profiles = await loadProfiles(storage);
  const next = [profile, ...profiles.filter((item) => item.id !== profile.id)];
  await storage.setItem(PROFILE_KEY, JSON.stringify(next));
  await storage.setItem(ACTIVE_KEY, profile.id);
  return next;
}

export async function getActiveProfile(
  storage: KeyValueStorage = defaultStorage
): Promise<GatewayProfile | null> {
  const [profiles, activeId] = await Promise.all([
    loadProfiles(storage),
    storage.getItem(ACTIVE_KEY),
  ]);
  return profiles.find((profile) => profile.id === activeId) || profiles[0] || null;
}

export async function clearActiveProfile(storage: KeyValueStorage = defaultStorage): Promise<void> {
  const [profiles, activeId] = await Promise.all([
    loadProfiles(storage),
    storage.getItem(ACTIVE_KEY),
  ]);
  const nextProfiles = activeId
    ? profiles.filter((profile) => profile.id !== activeId)
    : profiles.slice(1);

  if (nextProfiles.length > 0) {
    await storage.setItem(PROFILE_KEY, JSON.stringify(nextProfiles));
  } else {
    await storage.removeItem(PROFILE_KEY);
  }
  await storage.removeItem(ACTIVE_KEY);
}
