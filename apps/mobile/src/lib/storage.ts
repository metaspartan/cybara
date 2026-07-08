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

type SecureStoreLike = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

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

const secureStorage: KeyValueStorage = {
  async getItem(key) {
    const store = await loadSecureStore();
    if (store) {
      try {
        const secure = await store.getItemAsync(key);
        if (secure !== null) return secure;
      } catch {
        /* fall through */
      }
    }
    let legacy: string | null = null;
    try {
      legacy = await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
    if (legacy !== null && store) {
      try {
        await store.setItemAsync(key, legacy);
        await AsyncStorage.removeItem(key);
      } catch {
        /* keep legacy copy */
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
        /* fall through */
      }
    }
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      throw new Error("Could not save the gateway profile on this device.");
    }
  },
  async removeItem(key) {
    const store = await loadSecureStore();
    if (store) {
      try {
        await store.deleteItemAsync(key);
      } catch {
        /* ignore */
      }
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const defaultStorage: KeyValueStorage = secureStorage;

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
