import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePetEnabled, readPetEnabled } from "../../ui/src/lib/petPreferences";

const nativeSettingsSource = readFileSync(
  fileURLToPath(
    new URL("../../apps/macos/Cybara/Sources/Cybara/NativeSettingsScreen.swift", import.meta.url)
  ),
  "utf8"
);
const nativePetSource = readFileSync(
  fileURLToPath(new URL("../../apps/macos/Cybara/Sources/Cybara/PetPanel.swift", import.meta.url)),
  "utf8"
);

describe("pet preferences", () => {
  test("requires an explicit opt-in", () => {
    expect(parsePetEnabled(null)).toBe(false);
    expect(parsePetEnabled("0")).toBe(false);
    expect(parsePetEnabled("true")).toBe(false);
    expect(parsePetEnabled("1")).toBe(true);
    expect(readPetEnabled()).toBe(false);
  });

  test("keeps native macOS disabled until explicitly enabled", () => {
    expect(nativeSettingsSource).toContain(
      '@AppStorage("cybara.petEnabled") private var petEnabled = false'
    );
    expect(nativePetSource).toContain(
      'UserDefaults.standard.object(forKey: "cybara.petEnabled") as? Bool ?? false'
    );
  });
});
