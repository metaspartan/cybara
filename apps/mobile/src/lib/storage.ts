import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GatewayProfile } from "./connection";

const PROFILE_KEY = "cybara.mobile.gatewayProfiles";
const ACTIVE_KEY = "cybara.mobile.activeGatewayId";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// expo-secure-store is a native module (iOS Keychain / Android Keystore). Load
// it lazily and defensively: resolve to a usable module ONLY if every method we
// need is actually a function, otherwise null so we fall back to AsyncStorage.
// This keeps the app crash-free on a dev client that hasn't been rebuilt with
// the native module yet, while giving encrypted-at-rest storage once it has.
type SecureStoreLike = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};
let secureStorePromise: Promise<SecureStoreLike | null> | null = null;
function loadSecureStore(): Promise<SecureStoreLike | null> {
  if (!secureStorePromise) {
    secureStorePromise = (async () => {
      try {
        const mod = (await import("expo-secure-store")) as Partial<SecureStoreLike>;
        if (
          typeof mod?.getItemAsync === "function" &&
          typeof mod?.setItemAsync === "function" &&
          typeof mod?.deleteItemAsync === "function"
        ) {
          // Probe once so a native-module-missing error surfaces here (and is
          // swallowed) rather than on the first real read.
          await mod.getItemAsync("cybara.securestore.probe");
          return mod as SecureStoreLike;
        }
        return null;
      } catch {
        return null;
      }
    })();
  }
  return secureStorePromise;
}

// The gateway profile carries the API bearer token, so persist it in the OS
// secure enclave when available, with AsyncStorage fallback + one-time
// migration of any pre-existing plaintext value.
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
