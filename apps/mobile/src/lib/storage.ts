import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GatewayProfile } from "./connection";
import { SecureStore } from "./expoNativeModules";

const PROFILE_KEY = "cybara.mobile.gatewayProfiles";
const ACTIVE_KEY = "cybara.mobile.activeGatewayId";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type SecureStoreLike = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY?: number;
  getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

type SecureStoreOptions = {
  keychainAccessible?: number;
};

function secureStoreOptions(store: SecureStoreLike): SecureStoreOptions | undefined {
  return typeof store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY === "number"
    ? { keychainAccessible: store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
    : undefined;
}

let secureStoreProbe: Promise<SecureStoreLike | null> | null = null;
function loadSecureStore(): Promise<SecureStoreLike | null> {
  if (!secureStoreProbe) {
    secureStoreProbe = (async () => {
      const store = SecureStore as Partial<SecureStoreLike>;
      if (
        typeof store.getItemAsync !== "function" ||
        typeof store.setItemAsync !== "function" ||
        typeof store.deleteItemAsync !== "function"
      ) {
        return null;
      }
      try {
        await store.getItemAsync("cybara.securestore.probe");
        return store as SecureStoreLike;
      } catch {
        return null;
      }
    })();
  }
  return secureStoreProbe;
}

export function createSecureProfileStorage(
  storeLoader: () => Promise<SecureStoreLike | null> = loadSecureStore,
  legacyStorage: KeyValueStorage = AsyncStorage
): KeyValueStorage {
  return {
    async getItem(key) {
      const store = await storeLoader();
      if (!store) throw new Error("Secure credential storage is unavailable on this device.");
      const secure = await store.getItemAsync(key, secureStoreOptions(store));
      if (secure !== null) return secure;
      const legacy = await legacyStorage.getItem(key);
      if (legacy === null) return null;
      await store.setItemAsync(key, legacy, secureStoreOptions(store));
      await legacyStorage.removeItem(key);
      return legacy;
    },
    async setItem(key, value) {
      const store = await storeLoader();
      if (!store) throw new Error("Secure credential storage is unavailable on this device.");
      try {
        await store.setItemAsync(key, value, secureStoreOptions(store));
        await legacyStorage.removeItem(key);
      } catch {
        throw new Error("Could not save the gateway profile on this device.");
      }
    },
    async removeItem(key) {
      const store = await storeLoader();
      if (store) {
        try {
          await store.deleteItemAsync(key);
        } catch {}
      }
      try {
        await legacyStorage.removeItem(key);
      } catch {}
    },
  };
}

const defaultStorage: KeyValueStorage = createSecureProfileStorage();

export async function loadProfiles(
  storage: KeyValueStorage = defaultStorage
): Promise<GatewayProfile[]> {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(PROFILE_KEY);
  } catch {
    return [];
  }
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
  const profiles = await loadProfiles(storage);
  let activeId: string | null = null;
  try {
    activeId = await storage.getItem(ACTIVE_KEY);
  } catch {
    activeId = null;
  }
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
