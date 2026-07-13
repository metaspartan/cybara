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
  });

  test("lists goal, loop, and prompt commands for composer discovery", () => {
    const commands = listChatCommands();
    expect(commands.map((command) => command.token)).toEqual(
      expect.arrayContaining(["/goal", "/loop", "/learn", "/plan", "/review", "/test"])
    );
    expect(commands.every((command) => command.kind === "command")).toBe(true);
  });

  test("resolves a built-in tool mention to its instruction", async () => {
    const resolved = await resolveChatCapabilityMentions("Please @exec the tests", process.cwd());
    expect(resolved.mentions.map((mention) => mention.token)).toContain("@exec");
    expect(resolved.instruction).toContain("exec");
  });

  test("exposes connected accounts as explicit chat capabilities", async () => {
    updateAccountConnectorConfig("dropbox", { clientId: "dropbox-app" });
    storeAccountConnectorToken("dropbox", {
      accessToken: "access-token",
      scopes: ["account_info.read", "files.metadata.read", "files.content.read"],
    });
    try {
      const resolved = await resolveChatCapabilityMentions("Search @dropbox", process.cwd());
      expect(resolved.mentions).toContainEqual(
        expect.objectContaining({ kind: "connector", token: "@dropbox" })
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

  test("embeds virtual bundled skill instructions instead of treating them as files", async () => {
    const resolved = await resolveChatCapabilityMentions("Use @diagramming", process.cwd());
    expect(resolved.instruction).toContain("complete inline skill instructions");
    expect(resolved.instruction).toContain("do not call read");
    expect(resolved.instruction).not.toContain('read "builtin:diagramming"');
  });

  test("leaves turns unchanged when no capability is selected", async () => {
    const messages = [{ role: "user" as const, content: "hello @unknown" }];
    expect(await applyChatCapabilityMentions(messages, messages[0].content, process.cwd())).toEqual(
      messages
    );
  });
});
