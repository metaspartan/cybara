import AsyncStorage from "@react-native-async-storage/async-storage";

export const MOBILE_CHAT_CACHE_KEYS = {
  optimisticTranscripts: "cybara.mobile.optimisticTranscripts",
  optimisticPendingQueue: "cybara.mobile.optimisticPendingQueue",
  lastSessionId: "cybara.mobile.lastSessionId",
} as const;

const PERSIST_DEBOUNCE_MS = 400;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function readPersistedJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function schedulePersistJson(key: string, read: () => unknown): void {
  const existing = persistTimers.get(key);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    key,
    setTimeout(() => {
      persistTimers.delete(key);
      void (async () => {
        try {
          const value = read();
          if (value === null || value === undefined) {
            await AsyncStorage.removeItem(key);
          } else {
            await AsyncStorage.setItem(key, JSON.stringify(value));
          }
        } catch {}
      })();
    }, PERSIST_DEBOUNCE_MS)
  );
}

export async function persistLastOpenedSessionId(sessionId: string | null): Promise<void> {
  try {
    if (sessionId?.trim()) {
      await AsyncStorage.setItem(MOBILE_CHAT_CACHE_KEYS.lastSessionId, sessionId.trim());
    } else {
      await AsyncStorage.removeItem(MOBILE_CHAT_CACHE_KEYS.lastSessionId);
    }
  } catch {}
}

export async function readLastOpenedSessionId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(MOBILE_CHAT_CACHE_KEYS.lastSessionId);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}
