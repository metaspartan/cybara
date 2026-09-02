import { describe, expect, test } from "bun:test";

const webSource = await Bun.file("ui/src/pages/Agents.tsx").text();
const mobileSource = await Bun.file(
  "apps/mobile/src/screens/dashboardAgentSettingsPanel.tsx"
).text();
const mobileSurfaceSource = await Bun.file(
  "apps/mobile/src/screens/dashboardSurfaceData.ts"
).text();
const nativeSource = await Bun.file(
  "apps/macos/Cybara/Sources/Cybara/NativeAgentsScreen.swift"
).text();
const nativeModelsSource = await Bun.file(
  "apps/macos/Cybara/Sources/Cybara/GatewayChatModels.swift"
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

  test("all agent editors persist explicit image input capability overrides", () => {
    expect(webSource).toContain('name="image_input"');
    expect(webSource).toContain("config.image_input = imageInput");
    expect(mobileSource).toContain('label="Image input"');
    expect(mobileSource).toContain("nextConfig.image_input = imageInput");
    expect(nativeSource).toContain('Picker("Image input"');
    expect(nativeSource).toContain('config["image_input"] = imageInput');
    expect(nativeModelsSource).toContain("var imageInputMode: String");
  });

  test("agent lists show effective image input status and its source mode", () => {
    expect(webSource).toContain("agent.image_input_mode");
    expect(webSource).toContain('label: `Auto · ${enabled ? "enabled" : "disabled"}`');
    expect(webSource).toContain('title: `Automatically ${enabled ? "enabled" : "disabled"}');
    expect(nativeSource).toContain("agent.imageStatusLabel");
    expect(nativeModelsSource).toContain("let image_input_mode: String?");
    expect(mobileSource).toContain("agent.image_input_mode");
    expect(mobileSource).toContain("agentImageStatusLabel(agent)");
    expect(mobileSurfaceSource).toContain("agentImageStatusLabel(agent)");
  });

  test("the web editor waits for complete agent data before mounting uncontrolled fields", () => {
    expect(webSource).toContain('key={editingAgent?.id ?? "agent-editor-loading"}');
    expect(webSource).toContain("isOpen={!!editingAgentId && !!editingAgent}");
  });
});
