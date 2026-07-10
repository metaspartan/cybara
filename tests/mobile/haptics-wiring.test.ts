import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("mobile haptic wiring", () => {
  test("pins the Expo module and installs the preference provider", () => {
    const packageJson = JSON.parse(source("apps/mobile/package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies["expo-haptics"]).toBe("56.0.3");
    expect(source("apps/mobile/App.tsx")).toContain("<HapticsProvider>");
  });

  test("surfaces a local toggle and chat lifecycle feedback", () => {
    const settings = source("apps/mobile/src/screens/dashboardDetailPanels.tsx");
    const chat = source("apps/mobile/src/screens/dashboardSessionDetail.tsx");
    expect(settings).toContain('label="Haptic feedback"');
    expect(settings).toContain("setHapticsEnabled(!hapticsEnabled)");
    expect(chat).toContain("haptics.messageSent()");
    expect(chat).toContain("haptics.agentStarted()");
    expect(chat).toContain("haptics.agentProgress()");
    expect(chat).toContain("haptics.agentCompleted()");
    expect(chat).toContain("responseHapticActiveRef.current = false");
  });
});
