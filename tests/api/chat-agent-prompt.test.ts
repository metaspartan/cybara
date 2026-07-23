import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  activeAgentSystemPrompt,
  refreshSessionAgentSystemPromptIfNeeded,
} from "../../src/api/chat-agent-prompt";

const explicitToolAgent = {
  id: "agent-token-lean",
  name: "Token Lean",
  model: "MiniMax-M3",
  tools: [{ name: "read" }, { name: "browser" }],
  config: {},
  system_prompt: "",
};

describe("chat agent prompt tool mode", () => {
  test("uses a lean system prompt when a chat turn disables tools", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    const prompt = await activeAgentSystemPrompt(
      explicitToolAgent,
      workspace,
      [{ role: "user", content: "Reply in one sentence." }],
      { useTools: false }
    );
    rmSync(workspace, { recursive: true, force: true });

    expect(prompt).toContain("No platform tools are enabled for this turn");
    expect(prompt).not.toContain("- read:");
    expect(prompt).not.toContain("### Browser Tool");
    expect(prompt.length).toBeLessThan(1200);
  });

  test("keeps explicit tool guidance when tools are enabled", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    const prompt = await activeAgentSystemPrompt(explicitToolAgent, workspace, [
      { role: "user", content: "Inspect example.com." },
    ]);
    rmSync(workspace, { recursive: true, force: true });

    expect(prompt).toContain("Available tools: read, browser");
    expect(prompt).toContain("### Browser Tool");
    expect(prompt).not.toContain("## Reply Tags");
    expect(prompt).not.toContain("## Silent Replies");
  });

  test("adds channel-only reply semantics only for channel sessions", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    try {
      const prompt = await activeAgentSystemPrompt(
        explicitToolAgent,
        workspace,
        [{ role: "user", content: "Reply to Discord." }],
        { runtimeChannel: "discord" }
      );

      expect(prompt).toContain("## Reply Tags");
      expect(prompt).toContain("## Messaging");
      expect(prompt).toContain("## Silent Replies");
      expect(prompt).toContain("channel=discord");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("gives every execution agent a tool-forward completion contract", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    const prompt = await activeAgentSystemPrompt(
      {
        ...explicitToolAgent,
        id: "agent-kimi-execute",
        model: "custom-model",
        type: "coder",
      },
      workspace
    );
    rmSync(workspace, { recursive: true, force: true });

    expect(prompt).toContain("## Execution Mode");
    expect(prompt).toContain("Plans and todos are working state");
    expect(prompt).toContain("Use tools for concrete workspace, coding, research");
    expect(prompt).toContain("Do not invent files, state, results, or tool output");
  });

  test("allows planner agents to finish with a grounded plan", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    const prompt = await activeAgentSystemPrompt(
      {
        ...explicitToolAgent,
        id: "agent-planner",
        model: "kimi-for-coding/kimi-k3",
        type: "planner",
      },
      workspace
    );
    rmSync(workspace, { recursive: true, force: true });

    expect(prompt).toContain("## Planning Mode");
    expect(prompt).toContain("A plan is a valid final response in this mode");
    expect(prompt).not.toContain("Treat actionable requests as work to perform");
  });

  test("loads workspace instructions into active chat prompts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    try {
      writeFileSync(join(workspace, "AGENTS.md"), "Use focused tests.", "utf8");
      const prompt = await activeAgentSystemPrompt(explicitToolAgent, workspace, [
        { role: "user", content: "Inspect the project." },
      ]);

      expect(prompt).toContain(`## ${join(workspace, "AGENTS.md")}`);
      expect(prompt).toContain("Use focused tests.");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("keeps a session prompt stable while its effective tool set is unchanged", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    try {
      const content = await activeAgentSystemPrompt(explicitToolAgent, workspace);
      const session = {
        agentId: explicitToolAgent.id,
        messages: [{ role: "system" as const, content, timestamp: "stable" }],
        updatedAt: "stable",
        workspaceDir: workspace,
      };

      await refreshSessionAgentSystemPromptIfNeeded(session, explicitToolAgent);

      expect(session.messages[0]?.content).toBe(content);
      expect(session.messages[0]?.timestamp).toBe("stable");
      expect(session.updatedAt).toBe("stable");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("refreshes a session prompt when the effective tool set changes", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    try {
      const content = await activeAgentSystemPrompt(explicitToolAgent, workspace);
      const readOnlyAgent = { ...explicitToolAgent, tools: [{ name: "read" }] };
      const session = {
        agentId: explicitToolAgent.id,
        messages: [{ role: "system" as const, content, timestamp: "stable" }],
        updatedAt: "stable",
        workspaceDir: workspace,
      };

      await refreshSessionAgentSystemPromptIfNeeded(session, readOnlyAgent);

      expect(session.messages[0]?.content).toContain("Available tools: read");
      expect(session.messages[0]?.content).not.toContain("Available tools: read, browser");
      expect(session.updatedAt).not.toBe("stable");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("refreshes a session prompt when its delivery channel changes", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    try {
      const content = await activeAgentSystemPrompt(explicitToolAgent, workspace);
      const session = {
        agentId: explicitToolAgent.id,
        messages: [{ role: "system" as const, content, timestamp: "stable" }],
        updatedAt: "stable",
        workspaceDir: workspace,
      };

      await refreshSessionAgentSystemPromptIfNeeded(session, explicitToolAgent, undefined, {
        runtimeChannel: "telegram",
      });

      expect(session.messages[0]?.content).toContain("channel=telegram");
      expect(session.messages[0]?.content).toContain("## Reply Tags");
      expect(session.updatedAt).not.toBe("stable");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
