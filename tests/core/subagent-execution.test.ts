import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import type { ToolDefinition } from "../../src/core/database";
import { resetSubagentRegistryForTests } from "../../src/core/subagent-registry";
import {
  getSubagentSession,
  handleSessionsSpawn,
  resetSubagentSessionsForTests,
} from "../../src/core/tools/handlers/channel";

type ExecuteShape = (
  agentId: string,
  messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>,
  options?: {
    useTools?: boolean;
    sessionId?: string;
    workspaceDir?: string;
    channel?: string;
    userId?: string;
    modelOverride?: string;
  }
) => Promise<{ content: string; tool_calls?: Array<{ name: string; result: unknown }> }>;

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

async function waitFor(predicate: () => boolean, timeoutMs = 1000, intervalMs = 10): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for subagent completion");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
  resetSubagentSessionsForTests();
  resetSubagentRegistryForTests();
});

describe("Subagent execution wiring", () => {
  test("uses requested agent id and model override through agentManager.execute", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Provider",
      api_key: "subagent-key",
    });
    createdProviderIds.push(provider.id);

    const firstAgent = agentManager.create({
      name: "First Agent",
      type: "main",
      provider_id: provider.id,
      model: "model-first",
      tools: [],
    });
    createdAgentIds.push(firstAgent.id);

    const targetAgent = agentManager.create({
      name: "Target Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-target",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const requestedModel = "model-override";
    const task = "summarize deployment status";

    let captured:
      | {
          agentId: string;
          messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
          options?: {
            useTools?: boolean;
            sessionId?: string;
            workspaceDir?: string;
            channel?: string;
            userId?: string;
            modelOverride?: string;
          };
        }
      | undefined;

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async (
      agentId,
      messages,
      options
    ) => {
      captured = { agentId, messages, options };
      return { content: "subagent complete" };
    };

    try {
      const spawnResult = await handleSessionsSpawn({
        task,
        agentId: targetAgent.id,
        model: requestedModel,
        _requesterSessionKey: "main",
      });

      expect(spawnResult.status).toBe("accepted");
      expect(spawnResult.modelApplied).toBe(true);

      await waitFor(
        () => getSubagentSession(spawnResult.childSessionKey)?.status === "completed",
        2000
      );

      const session = getSubagentSession(spawnResult.childSessionKey);
      expect(session?.status).toBe("completed");
      expect(session?.result).toBe("subagent complete");

      expect(captured?.agentId).toBe(targetAgent.id);
      expect(captured?.options?.useTools).toBe(true);
      expect(captured?.options?.channel).toBe("subagent");
      expect(captured?.options?.userId).toBe("subagent");
      expect(captured?.options?.sessionId).toBe(spawnResult.childSessionKey);
      expect(captured?.options?.workspaceDir).toBeUndefined();
      expect(captured?.options?.modelOverride).toBe(requestedModel);
      const lastMessage =
        captured && captured.messages.length > 0
          ? captured.messages[captured.messages.length - 1]
          : undefined;
      expect(lastMessage).toEqual({ role: "user", content: task });
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("enforces the same tool allowlist guardrails for subagent runs", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Guardrail Provider",
      api_key: "subagent-guardrail-key",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const calcOnlyTool: ToolDefinition = {
      name: "calc",
      description: "Evaluate math expressions",
      input_schema: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    };

    const guardedAgent = agentManager.create({
      name: "Subagent Guardrail Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "gpt-5.2",
      tools: [calcOnlyTool],
    });
    createdAgentIds.push(guardedAgent.id);

    const requestBodies: Array<Record<string, unknown>> = [];
    let completionCalls = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      completionCalls += 1;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      requestBodies.push(body as Record<string, unknown>);

      if (completionCalls === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-subagent-1",
            object: "chat.completion",
            model: "gpt-5.2",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-subagent-1",
                      type: "function",
                      function: {
                        name: "read",
                        arguments: JSON.stringify({ path: "/tmp/secret.txt" }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-subagent-2",
          object: "chat.completion",
          model: "gpt-5.2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "subagent done",
              },
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const spawnResult = await handleSessionsSpawn({
      task: "read sensitive file",
      agentId: guardedAgent.id,
      _requesterSessionKey: "main",
    });

    expect(spawnResult.status).toBe("accepted");

    await waitFor(
      () => getSubagentSession(spawnResult.childSessionKey)?.status === "completed",
      2000
    );

    const session = getSubagentSession(spawnResult.childSessionKey);
    expect(session?.result).toBe("subagent done");
    expect(requestBodies.length).toBeGreaterThanOrEqual(2);

    const secondRequestMessages =
      (requestBodies[1]?.messages as Array<{ role?: string; content?: string }>) || [];
    const toolMessage = secondRequestMessages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("Tool not enabled for this agent: read");
  });

  test("blocks nested subagent spawning from subagent sessions", async () => {
    const nestedSpawn = await handleSessionsSpawn({
      task: "attempt nested spawn",
      _requesterSessionKey: "agent:parent-agent:subagent:child-session",
    });

    expect(nestedSpawn.status).toBe("forbidden");
    expect(nestedSpawn.warning).toContain("not allowed from sub-agent sessions");
  });

  test("propagates requester session/workspace from tool context when args omit them", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Context Provider",
      api_key: "subagent-context-key",
    });
    createdProviderIds.push(provider.id);

    const targetAgent = agentManager.create({
      name: "Context Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-context",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const workspaceDir = process.cwd();
    const requesterSessionKey = "chat:session:abc123";

    let captured:
      | {
          options?: {
            sessionId?: string;
            workspaceDir?: string;
          };
        }
      | undefined;

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async (
      _agentId,
      _messages,
      options
    ) => {
      captured = { options };
      return { content: "done" };
    };

    try {
      const spawnResult = await handleSessionsSpawn(
        {
          task: "context propagation",
          agentId: targetAgent.id,
        },
        {
          agentId: targetAgent.id,
          sessionId: requesterSessionKey,
          workspaceDir,
        }
      );

      expect(spawnResult.status).toBe("accepted");
      await waitFor(
        () => getSubagentSession(spawnResult.childSessionKey)?.status === "completed",
        2000
      );

      const subagentSession = getSubagentSession(spawnResult.childSessionKey);
      expect(subagentSession?.parentSessionId).toBe(requesterSessionKey);
      expect(subagentSession?.workspaceDir).toBe(workspaceDir);
      expect(captured?.options?.workspaceDir).toBe(workspaceDir);
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });
});
