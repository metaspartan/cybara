import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GatewayProfile } from "./connection";

const PROFILE_KEY = "cybara.mobile.gatewayProfiles";
const ACTIVE_KEY = "cybara.mobile.activeGatewayId";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const defaultStorage: KeyValueStorage = AsyncStorage;

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
