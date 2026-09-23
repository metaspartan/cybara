import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import { resetRouterForTests } from "../../src/core/router";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  config.set("tool_approval_mode", "ask");
  config.set("router", null);
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
  resetRouterForTests();
});

describe("Codex runtime empty stops", () => {
  test("openai codex tool-call narration cannot replace an empty final answer", async () => {
    config.set("tool_approval_mode", "always_allow");
    const requestBodies: Array<Record<string, unknown>> = [];
    const turns = [
      [
        { type: "response.output_text.delta", delta: "I'll check that." },
        {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            id: "fc_calc",
            call_id: "call_calc",
            name: "calc",
            arguments: '{"expression":"2+2"}',
          },
        },
        { type: "response.completed", response: { status: "completed" } },
      ],
      [{ type: "response.completed", response: { status: "completed" } }],
      [
        { type: "response.output_text.delta", delta: "The checked result is 4." },
        { type: "response.completed", response: { status: "completed" } },
      ],
    ];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requestBodies.push(body);
      const events = turns[requestBodies.length - 1] ?? turns[turns.length - 1];
      const payload = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
      return new Response(payload, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex Closing Response Provider",
      access_token: "codex-test-token",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenAI Codex Closing Response Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.3-codex",
      tools: ["calc"],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "can you check what 2+2 is?" }],
      { useTools: true, sessionId: "openai-codex-closing-response-session" }
    );

    expect(result.content).toBe("The checked result is 4.");
    expect(result.content).not.toBe("I'll check that.");
    expect(result.tool_calls?.map((call) => call.name)).toContain("calc");
    expect(result.tool_calls?.map((call) => call.id)).toContain("call_calc|fc_calc");
    expect(requestBodies).toHaveLength(3);
    expect(requestBodies[2]?.tool_choice).toBe("auto");
    expect(JSON.stringify(requestBodies[2]?.input)).toContain(
      "make the next required tool call now"
    );
  });

  test("openai codex keeps working after an empty stop and only forces a summary after repeated empties", async () => {
    config.set("tool_approval_mode", "always_allow");
    const requestBodies: Array<Record<string, unknown>> = [];
    const calcCall = (id: string) => [
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: `fc_${id}`,
          call_id: `call_${id}`,
          name: "calc",
          arguments: '{"expression":"2+2"}',
        },
      },
      { type: "response.completed", response: { status: "completed" } },
    ];
    const empty = [{ type: "response.completed", response: { status: "completed" } }];
    const turns = [
      calcCall("one"),
      empty,
      calcCall("two"),
      empty,
      empty,
      [
        { type: "response.output_text.delta", delta: "Both checks returned 4." },
        { type: "response.completed", response: { status: "completed" } },
      ],
    ];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requestBodies.push(body);
      const events = turns[requestBodies.length - 1] ?? turns[turns.length - 1];
      const payload = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
      return new Response(payload, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex Empty Stop Provider",
      access_token: "codex-test-token",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenAI Codex Empty Stop Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.3-codex",
      tools: ["calc"],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "check 2+2 twice" }],
      { useTools: true, sessionId: "openai-codex-empty-stop-session" }
    );

    expect(result.content).toBe("Both checks returned 4.");
    expect(result.tool_calls?.filter((call) => call.name === "calc")).toHaveLength(2);
    expect(requestBodies).toHaveLength(6);
    expect(requestBodies[2]?.tool_choice).toBe("auto");
    expect(requestBodies[4]?.tool_choice).toBe("auto");
    expect(requestBodies[5]?.tool_choice).toBe("none");
    expect(JSON.stringify(requestBodies[5]?.input)).toContain("Do not call any more tools");
  });
});
