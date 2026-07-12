import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

function read(path: string): string {
  return readFileSync(join(root, "ui/src", path), "utf8");
}

describe("background polling", () => {
  test("usage polling pauses while the app is backgrounded", () => {
    expect(read("pages/Usage.tsx")).toContain("refetchIntervalInBackground: false");
  });

  test("router polling pauses while hidden and refreshes when visible", () => {
    const source = read("pages/RouterSettings.tsx");
    expect(source).toContain('document.visibilityState === "visible"');
    expect(source).toContain('document.addEventListener("visibilitychange", refreshAll)');
    expect(source).toContain('document.removeEventListener("visibilitychange", refreshAll)');
  });

  test("local speech loading polling pauses while hidden", () => {
    const source = read("pages/settings/SpeechSettingsSection.tsx");
    expect(source).toContain('document.visibilityState === "visible"');
    expect(source).toContain('document.addEventListener("visibilitychange", refreshVisible)');
    expect(source).toContain('document.removeEventListener("visibilitychange", refreshVisible)');
  });
});
