import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
}

describe("agents are ready on demand across clients", () => {
  test("web links agent identities to the primary chat without runtime controls", () => {
    const source = read("ui/src/pages/Agents.tsx");
    expect(source).toContain("buildAgentChatPath(agent.id)");
    expect(source).toContain("useAgentSummaries()");
    expect(source).toContain("useAgent(editingAgentId)");
    expect(source).not.toContain("handleToggleStatus");
    expect(source).not.toContain("ChatModal");
  });

  test("mobile agent settings edit configuration without start or stop actions", () => {
    const panel = read("apps/mobile/src/screens/dashboardAgentSettingsPanel.tsx");
    expect(panel).toContain('label="Save"');
    expect(panel).toContain('label="Delete"');
    expect(panel).toContain(".agent(item.id)");
    expect(panel).toContain("disabled={loadingAgent}");
    expect(panel).not.toContain("toggleAgentRuntime");
    expect(panel).not.toContain("api.startAgent");
    expect(panel).not.toContain("api.stopAgent");
  });

  test("native macOS agent rows edit configuration without activation controls", () => {
    const source = read("apps/macos/Cybara/Sources/Cybara/NativeAgentsScreen.swift");
    expect(source).toContain('subtitle: "Create and manage gateway agents"');
    expect(source).not.toContain("play.fill");
    expect(source).not.toContain("client.startAgent");
    expect(source).not.toContain("client.stopAgent");
    expect(source).not.toContain("Auto-start on gateway boot");
    expect(source).toContain("client.agent(agent.id)");
    expect(source).toContain("loadingAgentID == agent.id");
  });
});
