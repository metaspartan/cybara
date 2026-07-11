import { describe, expect, test } from "bun:test";

const webSource = await Bun.file("ui/src/pages/Agents.tsx").text();
const mobileSource = await Bun.file(
  "apps/mobile/src/screens/dashboardAgentSettingsPanel.tsx"
).text();
const nativeSource = await Bun.file(
  "apps/macos/Cybara/Sources/Cybara/NativeAgentsScreen.swift"
).text();

describe("agent tool profile surfaces", () => {
  test("web and Tauri persist agent tool profiles", () => {
    expect(webSource).toContain('name="tool_profile"');
    expect(webSource).toContain("config.tool_profile");
    expect(webSource).toContain('value: "coding"');
    expect(webSource).toContain('value: "safe"');
  });

  test("mobile and native macOS persist agent tool profiles", () => {
    expect(mobileSource).toContain('label="Tool profile"');
    expect(mobileSource).toContain("tool_profile: toolProfile");
    expect(nativeSource).toContain('Picker("Tool profile"');
    expect(nativeSource).toContain('config["tool_profile"] = toolProfile');
  });
});
