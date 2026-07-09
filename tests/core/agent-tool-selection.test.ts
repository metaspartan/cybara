import { afterEach, describe, expect, test } from "bun:test";
import { agentManager, resolveAgentToolSelection } from "../../src/core/agent";
import { normalizeExplicitAgentTools } from "../../src/core/agent-tool-normalization";
import { providerManager } from "../../src/core/providers";
import { getToolSchemasForLLM } from "../../src/core/tools/index";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];

type CallLLMShape = typeof agentManager.callLLM;

afterEach(() => {
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("resolveAgentToolSelection", () => {
  test("unset tools → use builtins", () => {
    expect(resolveAgentToolSelection(undefined)).toEqual({ kind: "builtins" });
    expect(resolveAgentToolSelection(null)).toEqual({ kind: "builtins" });
    expect(resolveAgentToolSelection("")).toEqual({ kind: "builtins" });
    expect(resolveAgentToolSelection("   ")).toEqual({ kind: "builtins" });
  });

  test("explicit array is honored verbatim", () => {
    const arr = [{ name: "read" }, { name: "grep" }];
    expect(resolveAgentToolSelection(arr)).toEqual({ kind: "explicit", tools: arr });
  });

  test("explicit EMPTY array means zero tools, NOT all tools (regression)", () => {
    expect(resolveAgentToolSelection([])).toEqual({ kind: "explicit", tools: [] });
    expect(resolveAgentToolSelection("[]")).toEqual({ kind: "explicit", tools: [] });
  });

  test("JSON string array is parsed and honored", () => {
    expect(resolveAgentToolSelection('[{"name":"read"}]')).toEqual({
      kind: "explicit",
      tools: [{ name: "read" }],
    });
  });

  test("nested serialized JSON arrays are parsed without widening permissions", () => {
    const nested = JSON.stringify(JSON.stringify([{ name: "read" }]));

    expect(resolveAgentToolSelection(nested)).toEqual({
      kind: "explicit",
      tools: [{ name: "read" }],
    });
  });

  test("corrupt/non-array config fails closed, never widens to all tools", () => {
    expect(resolveAgentToolSelection("{not json").kind).toBe("malformed");
    expect(resolveAgentToolSelection('{"tools":"read"}').kind).toBe("malformed");
    expect(resolveAgentToolSelection("null").kind).toBe("malformed");
    expect(resolveAgentToolSelection(42).kind).toBe("malformed");
  });
});

describe("normalizeExplicitAgentTools", () => {
  test("refreshes broad legacy builtin snapshots to current enabled builtin tools", () => {
    const legacy = [
      "read",
      "write",
      "edit",
      "grep",
      "exec",
      "browser",
      "web_search",
      "web_fetch",
      "memory_search",
      "memory_get",
      "sessions_spawn",
      "sessions_send",
      "sessions_history",
      "sessions_list",
      "message",
      "canvas",
      "image",
      "tts",
      "cron",
      "gateway",
    ];

    const names = normalizeExplicitAgentTools(legacy).map((tool) => tool.name);
    const currentEnabledNames = getToolSchemasForLLM().map((tool) => tool.name);

    expect(names).toEqual(currentEnabledNames);
    expect(names).toContain("calc");
  });

  test("refreshes partial broad builtin snapshots instead of treating them as fixed schemas", () => {
    const partialLegacy = getToolSchemasForLLM()
      .filter((tool) => !["sessions_send", "sessions_spawn", "wallet"].includes(tool.name))
      .slice(0, 42)
      .map((tool) => ({
        name: tool.name,
        description: `stale ${tool.name}`,
        input_schema: { type: "object", properties: {} },
      }));

    const names = normalizeExplicitAgentTools(partialLegacy).map((tool) => tool.name);
    const currentEnabledNames = getToolSchemasForLLM().map((tool) => tool.name);

    expect(names).toEqual(currentEnabledNames);
    expect(names.length).toBeGreaterThan(partialLegacy.length);
  });

  test("keeps narrow intentional allowlists narrow", () => {
    expect(normalizeExplicitAgentTools([{ name: "read" }]).map((tool) => tool.name)).toEqual([
      "read",
    ]);
  });
});

describe("legacy broad builtin snapshots", () => {
  test("are narrowed by intent at execution time", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Intent Provider",
      api_key: "sk-intent",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const broadSnapshot = JSON.stringify(
      getToolSchemasForLLM().map((tool) => ({ name: tool.name }))
    );
    const agent = agentManager.create({
      name: "Intent Agent",
      provider_id: provider.id,
      model: "gpt-intent",
      tools: broadSnapshot,
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    const captured: string[][] = [];
    const originalCallLLM = agentManager.callLLM.bind(agentManager) as CallLLMShape;
    (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = async (
      _provider,
      _model,
      _messages,
      tools
    ) => {
      captured.push(tools.map((tool) => tool.name));
      return { content: "ok" };
    };

    try {
      await agentManager.execute(agent.id, [{ role: "user", content: "hello" }]);
      await agentManager.execute(agent.id, [{ role: "user", content: "review this repo" }]);
    } finally {
      (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = originalCallLLM;
    }

    expect(captured[0]).toEqual([]);
    expect(captured[1]).toEqual(expect.arrayContaining(["read", "grep", "exec", "git"]));
    expect(captured[1].length).toBeLessThan(getToolSchemasForLLM().length / 2);
  });

  test("partial broad builtin snapshots are narrowed by intent at execution time", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Partial Intent Provider",
      api_key: "sk-partial-intent",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const partialSnapshot = JSON.stringify(
      getToolSchemasForLLM()
        .filter((tool) => tool.name !== "sessions_send")
        .slice(0, 42)
        .map((tool) => ({ name: tool.name }))
    );
    const agent = agentManager.create({
      name: "Partial Intent Agent",
      provider_id: provider.id,
      model: "gpt-partial-intent",
      tools: partialSnapshot,
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    const captured: string[][] = [];
    const originalCallLLM = agentManager.callLLM.bind(agentManager) as CallLLMShape;
    (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = async (
      _provider,
      _model,
      _messages,
      tools
    ) => {
      captured.push(tools.map((tool) => tool.name));
      return { content: "ok" };
    };

    try {
      await agentManager.execute(agent.id, [
        { role: "user", content: "review repo token usage in package.json" },
      ]);
    } finally {
      (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = originalCallLLM;
    }

    expect(captured[0]).toEqual(expect.arrayContaining(["read", "grep", "exec", "git"]));
    expect(captured[0]).not.toContain("wallet");
    expect(captured[0].length).toBeLessThan(getToolSchemasForLLM().length / 2);
  });
});
