import { afterEach, describe, expect, test } from "bun:test";
import {
  deleteSession,
  getSessionMessages,
  handleChat,
  updateSessionAgent,
} from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { extractLatestSessionPlan } from "../../src/core/session-plan";
import { readTodo } from "../../src/core/tools/handlers/todo";

interface ProviderRequestMessage {
  role?: string;
  content?: string;
}

interface ProviderRequestBody {
  model?: string;
  messages?: ProviderRequestMessage[];
  tools?: Array<{ function?: { name?: string } }>;
}

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalFetch = globalThis.fetch;

function completionResponse(model: string, content: string): Response {
  return Response.json({
    id: crypto.randomUUID(),
    object: "chat.completion",
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
  });
}

function todoResponse(
  model: string,
  id: string,
  items: Array<{ content: string; status: string; priority: string }>
): Response {
  return Response.json({
    id,
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id,
              type: "function",
              function: { name: "todo", arguments: JSON.stringify({ items }) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
  });
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("chat plan handoff between agents", () => {
  test("replaces inherited stale work, accepts cancelled items, and persists a cleared plan", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Plan Handoff Provider",
      api_key: "sk-plan-handoff",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const firstAgent = agentManager.create({
      name: "Plan Handoff Agent A",
      type: "main",
      provider_id: provider.id,
      model: "gpt-plan-handoff-a",
      memory_enabled: false,
    });
    const secondAgent = agentManager.create({
      name: "Plan Handoff Agent B",
      type: "main",
      provider_id: provider.id,
      model: "gpt-plan-handoff-b",
      memory_enabled: false,
    });
    createdAgentIds.push(firstAgent.id, secondAgent.id);

    const createRequest = "Create a plan";
    const handoffRequest = "Take over, cancel obsolete work, and record the replacement as done";
    const clearRequest = "Clear the completed plan";
    let initialPlanCalls = 0;
    let handoffPlanCalls = 0;
    let clearPlanCalls = 0;

    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body || "{}")) as ProviderRequestBody;
      const model = request.model || "unknown";
      const lastMessage = request.messages?.at(-1);
      const offersTodo = request.tools?.some((tool) => tool.function?.name === "todo") === true;
      if (offersTodo && lastMessage?.role === "user" && lastMessage.content === createRequest) {
        initialPlanCalls += 1;
        return todoResponse(model, "todo-plan-a", [
          { content: "Old active work", status: "in_progress", priority: "high" },
          { content: "Old stale work", status: "pending", priority: "low" },
        ]);
      }
      if (offersTodo && lastMessage?.role === "user" && lastMessage.content === handoffRequest) {
        handoffPlanCalls += 1;
        return todoResponse(model, "todo-plan-b", [
          { content: "Obsolete inherited approach", status: "cancelled", priority: "low" },
          { content: "Replacement work", status: "completed", priority: "high" },
        ]);
      }
      if (offersTodo && lastMessage?.role === "user" && lastMessage.content === clearRequest) {
        clearPlanCalls += 1;
        return todoResponse(model, "todo-plan-clear", []);
      }
      if (model === secondAgent.model && clearPlanCalls > 0) {
        return completionResponse(model, "The completed plan is cleared.");
      }
      if (model === secondAgent.model) {
        return completionResponse(model, "The inherited plan is reconciled and ready.");
      }
      return completionResponse(model, "The initial plan is ready.");
    }) as typeof fetch;

    const sessionId = `plan-handoff-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const initial = await handleChat({
      message: createRequest,
      agentId: firstAgent.id,
      sessionId,
      tools: true,
    });
    expect(initial.message.content).toBe("The initial plan is ready.");
    expect(initialPlanCalls).toBe(1);

    await updateSessionAgent(sessionId, secondAgent.id);
    const handedOff = await handleChat({
      message: handoffRequest,
      sessionId,
      tools: true,
    });
    expect(handedOff.agent?.id).toBe(secondAgent.id);
    expect(handedOff.message.content).toBe("The inherited plan is reconciled and ready.");
    expect(handoffPlanCalls).toBe(1);
    expect(
      readTodo({ agentId: secondAgent.id, sessionId }).map(
        (item) => `${item.content}:${item.status}`
      )
    ).toEqual(["Obsolete inherited approach:cancelled", "Replacement work:completed"]);

    const cleared = await handleChat({ message: clearRequest, sessionId, tools: true });
    expect(cleared.message.content).toBe("The completed plan is cleared.");
    expect(clearPlanCalls).toBe(1);
    expect(cleared.plan?.items).toEqual([]);
    expect(cleared.plan?.summary.total).toBe(0);

    const persistedMessages = await getSessionMessages(sessionId);
    const persistedPlan = extractLatestSessionPlan(sessionId, persistedMessages);
    expect(persistedPlan?.items).toEqual([]);
    expect(persistedPlan?.summary.total).toBe(0);
  });
});
