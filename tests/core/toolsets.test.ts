import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import type { Agent } from "../../src/core/database";
import { providerManager } from "../../src/core/providers";
import { resolveAgentToolPolicy } from "../../src/core/toolsets";
import {
  handleToolCall,
  handleToolDescribe,
  handleToolSearch,
} from "../../src/core/tools/handlers/tool-discovery";
import { handleExecuteCode } from "../../src/core/tools/handlers/execute-code";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const id of createdAgentIds.splice(0)) agentManager.delete(id);
  for (const id of createdProviderIds.splice(0)) providerManager.delete(id);
});

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "toolset-agent",
    name: "Toolset Agent",
    status: "stopped",
    memory_enabled: false,
    ...overrides,
  };
}

describe("agent toolsets", () => {
  test("advertises the same tools for conversational and coding prompts", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Stable Toolset Provider",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const configuredAgent = agentManager.create({
      name: "Stable Toolset Agent",
      provider_id: provider.id,
      memory_enabled: false,
      config: { tool_profile: "full" },
    });
    createdAgentIds.push(configuredAgent.id);
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: "stable-toolset",
          object: "chat.completion",
          model: "gpt-test",
          choices: [
            { index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    await agentManager.execute(configuredAgent.id, [{ role: "user", content: "hello" }], {
      sessionId: "stable-toolset-chat",
    });
    await agentManager.execute(
      configuredAgent.id,
      [{ role: "user", content: "build and test an app in this workspace" }],
      { sessionId: "stable-toolset-code" }
    );

    const names = requestBodies.map((body) =>
      ((body.tools as Array<{ function?: { name?: string } }>) ?? []).map(
        (tool) => tool.function?.name
      )
    );
    expect(names).toHaveLength(2);
    expect(names[0]).toEqual(names[1]);
    expect(names[0]).toContain("read");
    expect(names[0]).toContain("tool_search");
  });

  test("uses a stable full profile independent of prompt wording", () => {
    const first = resolveAgentToolPolicy(agent());
    const second = resolveAgentToolPolicy(agent());
    expect(first.allowedToolNames).toEqual(second.allowedToolNames);
    expect(first.allowedToolNames).toContain("artifacts");
    expect(first.allowedToolNames).toContain("write");
    expect(first.offeredTools.map((tool) => tool.name)).not.toContain("kanban_show");
    expect(first.offeredTools.map((tool) => tool.name)).toContain("tool_search");
    expect(first.offeredTools.map((tool) => tool.name)).toContain("computer_use");
  });

  test("supports profiles and additive toolsets", () => {
    const coding = resolveAgentToolPolicy(agent({ config: { tool_profile: "coding" } }));
    expect(coding.allowedToolNames).toContain("write");
    expect(coding.offeredTools.map((tool) => tool.name)).toContain("computer_use");
    expect(coding.allowedToolNames).not.toContain("wallet");

    const codingAutomation = resolveAgentToolPolicy(
      agent({ config: { tool_profile: "coding", toolsets: ["automation"] } })
    );
    expect(codingAutomation.allowedToolNames).toContain("kanban_show");
  });

  test("keeps the safe profile read only", () => {
    const policy = resolveAgentToolPolicy(agent({ config: { tool_profile: "safe" } }));
    expect(policy.allowedToolNames).toContain("read");
    expect(policy.allowedToolNames).toContain("web_search");
    expect(policy.allowedToolNames).not.toContain("write");
    expect(policy.allowedToolNames).not.toContain("exec");
    expect(policy.offeredTools.map((tool) => tool.name)).not.toContain("computer_use");
    expect(policy.allowDynamicTools).toBe(false);
  });

  test("applies allow, deny, and inherited policy as intersections", () => {
    const policy = resolveAgentToolPolicy(
      agent({
        config: {
          tool_profile: "full",
          tool_policy: { allow: ["read", "write", "wallet"], deny: ["wallet"] },
        },
      }),
      ["read", "wallet"]
    );
    expect(policy.allowedToolNames).toEqual(["read"]);
  });

  test("preserves explicit per-agent tool lists", () => {
    const policy = resolveAgentToolPolicy(agent({ tools: [{ name: "read" }, { name: "calc" }] }));
    expect(policy.allowedToolNames.sort()).toEqual(["calc", "read"]);
    expect(policy.offeredTools.map((tool) => tool.name).sort()).toEqual(["calc", "read"]);
    expect(policy.allowDynamicTools).toBe(false);
  });

  test("fails closed for malformed profiles and toolsets", () => {
    expect(
      resolveAgentToolPolicy(agent({ config: { tool_profile: "unknown" } })).allowedToolNames
    ).toEqual([]);
    expect(
      resolveAgentToolPolicy(agent({ config: { toolsets: ["files", "unknown"] } })).allowedToolNames
    ).toEqual([]);
  });
});

describe("toolset execution boundaries", () => {
  const context = {
    agentId: "restricted-agent",
    allowedToolNames: ["read", "tool_search", "tool_describe", "tool_call", "execute_code"],
    allowDynamicTools: false,
  };

  test("filters search and describe results", async () => {
    const search = await handleToolSearch({ query: "wallet", limit: 10 }, context);
    expect(search.matches).toEqual([]);
    const described = await handleToolDescribe({ name: "wallet" }, context);
    expect(described.found).toBe(false);
  });

  test("blocks nested tool_call execution outside the policy", async () => {
    await expect(handleToolCall({ name: "wallet", arguments: {} }, context)).rejects.toThrow(
      "not enabled for this agent"
    );
  });

  test("does not expose blocked tools through execute_code", async () => {
    const result = await handleExecuteCode(
      { code: "typeof cybara.wallet", language: "javascript" },
      context
    );
    expect(result.ok).toBe(true);
    expect(result.result).toBeUndefined();
  });
});
