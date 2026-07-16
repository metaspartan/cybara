import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("Lab settings parity", () => {
  test("web settings govern Lab navigation, capture actions, and training exports", () => {
    const settings = source("ui/src/pages/settings/LabSettings.tsx");
    const lab = source("ui/src/pages/Evals.tsx");
    const sidebar = source("ui/src/components/layout/Sidebar.tsx");
    const timeline = source("ui/src/pages/chat/ChatMessageTimeline.tsx");

    expect(settings).toContain('label="Enable Lab"');
    expect(settings).toContain('label="Show golden turn actions"');
    expect(settings).toContain('label="Capture completed turns"');
    expect(settings).toContain('label="Redact exports by default"');
    expect(lab).toContain("Lab settings unavailable");
    expect(lab).toContain("defaultFormat={labSettings.defaultExportFormat}");
    expect(sidebar).toContain('.filter((item) => item !== "lab" || labEnabled)');
    expect(sidebar).toContain('if (item === "lab" && !labEnabled) return null;');
    expect(timeline).toContain('message.role === "assistant" && sessionId && goldenTurnsEnabled');
  });

  test("native macOS, mobile, and TUI expose the shared Lab state", () => {
    const nativeSettings = source("apps/macos/Cybara/Sources/Cybara/NativeSettingsScreen.swift");
    const nativeLab = source("apps/macos/Cybara/Sources/Cybara/NativeEvalsScreen.swift");
    const mobileLab = source("apps/mobile/src/screens/dashboardEvalsPanel.tsx");
    const tuiLab = source("src/cli/tui/components/evals.tsx");

    expect(nativeSettings).toContain('case .lab: return "settings.lab"');
    expect(nativeSettings).toContain('toggleRow(\n                            "Enable Lab"');
    expect(nativeLab).toContain("if !goldenTurnsEnabled");
    expect(mobileLab).toContain("api.config()");
    expect(mobileLab).toContain("Enable Lab");
    expect(mobileLab).toContain('exportResearch("distillation_sft")');
    expect(tuiLab).toContain('title="Lab"');
  });
});
