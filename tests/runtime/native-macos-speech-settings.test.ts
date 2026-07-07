import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../../apps/macos/Cybara/Sources/Cybara/NativeSettingsScreen.swift", import.meta.url),
  "utf8"
);

describe("native macOS speech settings wiring", () => {
  test("exposes speech tab and persists the shared speech config key", () => {
    expect(settingsSource).toContain('Label("Voice", systemImage: "waveform")');
    expect(settingsSource).toContain("private var speechTab: some View");
    expect(settingsSource).toContain('"speech": [');
    expect(settingsSource).toContain('"provider": speechTTSProvider');
    expect(settingsSource).toContain('"provider": speechSTTProvider');
    expect(settingsSource).toContain('Text("Native").tag("native")');
    expect(settingsSource).toContain('"providerId": speechSTTProviderId');
  });
});
