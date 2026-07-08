import { describe, expect, test } from "bun:test";
import {
  clearActiveProfile,
  getActiveProfile,
  loadProfiles,
  saveProfile,
  type KeyValueStorage,
} from "../../apps/mobile/src/lib/storage";
import type { GatewayProfile } from "../../apps/mobile/src/lib/connection";

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    async getItem(key) {
      return data.get(key) || null;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
    async removeItem(key) {
      data.delete(key);
    },
  };
}

const profile: GatewayProfile = {
  id: "studio:http://127.0.0.1:4269",
  name: "Studio",
  baseUrl: "http://127.0.0.1:4269",
  apiKey: "cybara_key",
  createdAt: "2026-06-30T00:00:00.000Z",
};

describe("mobile profile storage", () => {
  test("saves profiles and marks the latest one active", async () => {
    const storage = memoryStorage();
    await saveProfile(profile, storage);

    expect(await loadProfiles(storage)).toEqual([profile]);
    expect(await getActiveProfile(storage)).toEqual(profile);
  });

  test("replaces profiles by id instead of duplicating secrets", async () => {
    const storage = memoryStorage();
    await saveProfile(profile, storage);
    await saveProfile({ ...profile, apiKey: "new_key" }, storage);

    const profiles = await loadProfiles(storage);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].apiKey).toBe("new_key");
  });

  test("disconnect removes the active bearer-token profile", async () => {
    const storage = memoryStorage();
    await saveProfile(profile, storage);
    await clearActiveProfile(storage);

    expect(await loadProfiles(storage)).toEqual([]);
    expect(await getActiveProfile(storage)).toBeNull();
  });

  test("startup treats unreadable profile storage as no saved gateway", async () => {
    const storage: KeyValueStorage = {
      async getItem() {
        throw new Error("native storage unavailable");
      },
      async setItem() {},
      async removeItem() {},
    };

    await expect(loadProfiles(storage)).resolves.toEqual([]);
    await expect(getActiveProfile(storage)).resolves.toBeNull();
  });
});
