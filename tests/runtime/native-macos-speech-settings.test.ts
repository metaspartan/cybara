import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../../apps/macos/Cybara/Sources/Cybara/NativeSettingsScreen.swift", import.meta.url),
  "utf8"
);

describe("native macOS speech settings wiring", () => {
  test("exposes speech tab and persists the shared speech config key", () => {
    expect(settingsSource).toContain(
      'Label(NativeI18n.t("settings.voice"), systemImage: "waveform")'
    );
    expect(settingsSource).toContain("private var speechTab: some View");
    expect(settingsSource).toContain('"speech": [');
    expect(settingsSource).toContain('"provider": speechTTSProvider');
    expect(settingsSource).toContain('"provider": speechSTTProvider');
    expect(settingsSource).toContain('Text("Native").tag("native")');
    expect(settingsSource).toContain('Text("Kokoro 82M").tag("local")');
    expect(settingsSource).toContain('Toggle("Fallback to system voice"');
    expect(settingsSource).toContain('"providerId": speechSTTProviderId');
    expect(settingsSource).toContain('Text("Hands-free Conversation")');
    expect(settingsSource).toContain('Text("OpenAI").tag("openai")');
    expect(settingsSource).toContain('Text("Gemini").tag("gemini")');
    expect(settingsSource).toContain('Text("Moshi").tag("moshi")');
    expect(settingsSource).toContain('"bargeIn": speechRealtimeBargeIn');
    expect(settingsSource).toContain('"silenceDurationMs": Int(speechRealtimeSilence) ?? 700');
  });
});
