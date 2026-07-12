import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile settings: Speech lives on its own screen", () => {
  const screen =
    read("screens/DashboardScreen.tsx") +
    read("screens/dashboardDetailPanels.tsx") +
    read("screens/dashboardSettingsPanels.tsx") +
    read("screens/dashboardSpeechSettingsPanel.tsx") +
    read("screens/dashboardSurfaceData.ts");

  test("there is a dedicated SpeechSettingsPanel with TTS + STT sections", () => {
    expect(screen).toContain("function SpeechSettingsPanel(");
    expect(screen).toContain('<SettingsSection title="Text to speech">');
    expect(screen).toContain('<SettingsSection title="Speech to text">');
    expect(screen).toContain('label="STT mode"');
    expect(screen).toContain("Native dictation");
    expect(screen).toContain("Kokoro 82M · Local");
    expect(screen).toContain("System voice fallback");
    expect(screen).toContain('<SettingsSection title="Hands-free">');
    expect(screen).toContain('label="Conversation engine"');
    expect(screen).toContain("OpenAI Realtime");
    expect(screen).toContain("Gemini Live");
    expect(screen).toContain("Moshi server");
    expect(screen).toContain('label="Interrupt while speaking"');
  });

  test("speech is a drill-in detail route, not an inline settings section", () => {
    expect(screen).toContain('{ kind: "speech" }');
    expect(screen).toContain("<SpeechSettingsPanel");
    // The root settings panel opens it via a navigation row, not an inline block.
    expect(screen).toContain("onPress={openSpeech}");
    // The old inline speech form is gone from the root settings panel.
    expect(screen).not.toContain("void saveSpeechPatch(");
  });

  test("the Voice & Speech row is routed through the header + back stack", () => {
    expect(screen).toContain('title: "Voice & Speech"');
  });
});
