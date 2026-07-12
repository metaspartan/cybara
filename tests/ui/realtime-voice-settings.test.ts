import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../../ui/src/pages/settings/SpeechSettingsSection.tsx", import.meta.url),
  "utf8"
);
const realtimeSource = readFileSync(
  new URL("../../ui/src/pages/settings/RealtimeVoiceSettings.tsx", import.meta.url),
  "utf8"
);

describe("realtime voice settings", () => {
  test("uses a compact segmented layout with provider-specific controls", () => {
    expect(settingsSource).toContain('role="tablist"');
    expect(settingsSource).toContain('["output", "input", "realtime"]');
    expect(settingsSource).toContain("<RealtimeVoiceSettings");
    expect(realtimeSource).toContain("OpenAI Realtime");
    expect(realtimeSource).toContain("Gemini Live");
    expect(realtimeSource).toContain("Moshi-compatible server");
    expect(realtimeSource).toContain("testRealtimeVoiceConnection");
    expect(realtimeSource).toContain("status?.realtime?.ready");
    expect(realtimeSource).not.toContain("status?.realtime.ready");
  });

  test("uses the established theme-remapped settings surfaces", () => {
    expect(realtimeSource).toContain("border-white/10");
    expect(realtimeSource).toContain("bg-white/[0.03]");
    expect(realtimeSource).toContain("text-gray-400");
    expect(realtimeSource).not.toContain("text-foreground");
    expect(realtimeSource).not.toContain("text-muted-foreground");
    expect(realtimeSource).not.toContain("border-border");
    expect(realtimeSource).not.toContain("bg-muted/");
    expect(settingsSource).toContain("border-white/10 bg-black/20");
    expect(settingsSource).toContain("border-white/10 bg-white/[0.03]");
    expect(settingsSource).toContain("bg-white/10 text-white");
    expect(settingsSource).toContain("text-gray-400 hover:bg-white/5 hover:text-white");
  });
});
