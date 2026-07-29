import { describe, expect, test } from "bun:test";
import {
  applyChatCapabilityMentions,
  listChatCapabilities,
  listChatCommands,
  normalizeCapabilityAlias,
  resolveChatCapabilityMentions,
} from "../../src/core/chat/capability-mentions";
import { config } from "../../src/core/config";
import {
  storeAccountConnectorToken,
  updateAccountConnectorConfig,
} from "../../src/core/account-connectors/store";

describe("chat capability mentions", () => {
  test("normalizes names into stable mention aliases", () => {
    expect(normalizeCapabilityAlias("  Model Usage / Daily  ")).toBe("model-usage-daily");
    expect(normalizeCapabilityAlias("Z.ai_tools.v2")).toBe("z.ai_tools.v2");
  });

  test("lists unique readable capability tokens", async () => {
    const capabilities = await listChatCapabilities(process.cwd());
    expect(capabilities.length).toBeGreaterThan(0);
    expect(new Set(capabilities.map((capability) => capability.token)).size).toBe(
      capabilities.length
    );
    expect(capabilities.every((capability) => capability.token.startsWith("@"))).toBe(true);
  });

  test("includes built-in tool and agent capabilities alongside skills", async () => {
    const capabilities = await listChatCapabilities(process.cwd());
    const kinds = new Set(capabilities.map((capability) => capability.kind));
    expect(kinds.has("tool")).toBe(true);
    const execTool = capabilities.find(
      (capability) => capability.kind === "tool" && capability.token === "@exec"
    );
    expect(execTool).toBeDefined();
    expect(execTool?.source).toBe("Tool");
    expect(
      capabilities.find(
        (capability) => capability.kind === "skill" && capability.token === "@security-scan"
      )
    ).toBeDefined();
  });

  test("lists goal, loop, and prompt commands for composer discovery", () => {
    const commands = listChatCommands();
    expect(commands.map((command) => command.token)).toEqual(
      expect.arrayContaining(["/goal", "/loop", "/learn", "/plan", "/review", "/security", "/test"])
    );
    expect(commands.every((command) => command.kind === "command")).toBe(true);
  });

  test("resolves a built-in tool mention to its instruction", async () => {
    const resolved = await resolveChatCapabilityMentions("Please @exec the tests", process.cwd());
    expect(resolved.mentions.map((mention) => mention.token)).toContain("@exec");
    expect(resolved.instruction).toContain("exec");
  });

  test("selects the integrated security skill and tool from natural language", async () => {
    const resolved = await resolveChatCapabilityMentions(
      "Do a Codex Security scan of this repo",
      process.cwd()
    );
    expect(resolved.mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "skill", token: "@security-scan" }),
        expect.objectContaining({ kind: "tool", token: "@security_scan" }),
      ])
    );
    expect(resolved.instruction).toContain('skill_load with "security-scan"');
    expect(resolved.instruction).toContain('use the "security_scan" built-in tool');
  });

  test("exposes connected accounts as explicit chat capabilities", async () => {
    updateAccountConnectorConfig("microsoft_365", { clientId: "microsoft-app" });
    storeAccountConnectorToken("microsoft_365", {
      accessToken: "access-token",
      scopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        "User.Read",
        "Mail.Read",
        "Files.Read",
        "Calendars.Read",
      ],
    });
    try {
      const resolved = await resolveChatCapabilityMentions("Search @microsoft-365", process.cwd());
      expect(resolved.mentions).toContainEqual(
        expect.objectContaining({ kind: "connector", token: "@microsoft-365" })
      );
      expect(resolved.instruction).toContain("untrusted data");
    } finally {
      config.set("account_connectors", null);
    }
  });

  test("resolves exact mentions without matching email addresses or unknown names", async () => {
    const skill = (await listChatCapabilities(process.cwd())).find(
      (capability) => capability.kind === "skill"
    );
    expect(skill).toBeDefined();
    if (!skill) throw new Error("Expected at least one skill capability");
    const resolved = await resolveChatCapabilityMentions(
      `Use ${skill.token}, contact dev@example.com, and ignore @missing-capability.`,
      process.cwd()
    );
    expect(resolved.mentions.map((mention) => mention.token)).toEqual([skill.token]);
    expect(resolved.instruction).toContain(skill.token);
  });

  test("augments only the latest user turn without changing persisted content", async () => {
    const skill = (await listChatCapabilities(process.cwd())).find(
      (capability) => capability.kind === "skill"
    );
    expect(skill).toBeDefined();
    if (!skill) throw new Error("Expected at least one skill capability");
    const messages = [
      { role: "system" as const, content: "system" },
      { role: "user" as const, content: "earlier" },
      { role: "assistant" as const, content: "answer" },
      { role: "user" as const, content: `Please use ${skill.token}` },
    ];
    const augmented = await applyChatCapabilityMentions(
      messages,
      messages[3].content,
      process.cwd()
    );
    expect(messages[3].content).toBe(`Please use ${skill.token}`);
    expect(augmented[1].content).toBe("earlier");
    expect(augmented[3].content).toContain("<selected_capabilities>");
    expect(augmented[3].content).toContain(skill.token);
  });

  test("loads selected skills through the safe skill loader", async () => {
    const resolved = await resolveChatCapabilityMentions("Use @diagramming", process.cwd());
    expect(resolved.instruction).toContain("call skill_load");
    expect(resolved.instruction).toContain('skill_load with "diagramming"');
    expect(resolved.instruction).toContain("Do not read or search for a SKILL.md path");
  });

  test("leaves turns unchanged when no capability is selected", async () => {
    const messages = [{ role: "user" as const, content: "hello @unknown" }];
    expect(await applyChatCapabilityMentions(messages, messages[0].content, process.cwd())).toEqual(
      messages
    );
  });
});
