import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const capabilitySettings = readFileSync(
  join(root, "ui", "src", "pages", "settings", "ToolCapabilitySettings.tsx"),
  "utf8"
);
const browserSettings = readFileSync(
  join(root, "ui", "src", "pages", "settings", "BrowserSupervisionSettings.tsx"),
  "utf8"
);
const featureSettings = readFileSync(
  join(root, "ui", "src", "pages", "settings", "FeatureSettings.tsx"),
  "utf8"
);

describe("safety settings", () => {
  test("renders capability and browser policies through the themed select contract", () => {
    expect(capabilitySettings).toContain("options={POLICY_OPTIONS}");
    expect(capabilitySettings).not.toContain("<option");
    expect(browserSettings).toContain("options={DOWNLOAD_POLICY_OPTIONS}");
    expect(browserSettings).not.toContain("<option");
  });

  test("keeps remote sandbox credentials hidden until explicitly enabled", () => {
    expect(featureSettings).toContain("remoteSandboxEnabled");
    expect(featureSettings).toContain('label="Remote sandbox"');
    expect(featureSettings).toContain("{remoteSandboxEnabled ? (");
    expect(featureSettings).toContain('remoteUrl: ""');
    expect(featureSettings).toContain('remoteApiKey: ""');
  });

  test("uses theme surfaces for the reorganized safety controls", () => {
    expect(featureSettings).toContain("Runtime Safety");
    expect(featureSettings).toContain("Platform access");
    expect(featureSettings).toContain("Tool guardrails");
    expect(featureSettings).toContain("Command isolation");
    expect(featureSettings).not.toContain("border-white/10");
    expect(featureSettings).not.toContain("text-gray-");
  });
});
