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
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
  resetRouterForTests();
});

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function createAntigravityAgent(model: string, tools: string[]): string {
  const provider = providerManager.create({
    provider: "antigravity",
    name: "Antigravity Routing Provider",
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    access_token: `ya29.routing-${crypto.randomUUID()}`,
    expires_at: Date.now() + 3_600_000,
  });
  createdProviderIds.push(provider.id);
  const agent = agentManager.create({
    name: "Antigravity Routing Agent",
    type: "main",
    provider_id: provider.id,
    model,
    tools,
  });
  createdAgentIds.push(agent.id);
  return agent.id;
}

describe("Antigravity Cloud Code routing", () => {
  test("runs a Claude tool loop through Cloud Code with matching tool ids", async () => {
    config.set("tool_approval_mode", "always_allow");
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requests.push({ url, headers: new Headers(init?.headers), body });
      if (url.endsWith("v1internal:loadCodeAssist")) {
        return Response.json({ cloudaicompanionProject: "aicode-consumers" });
      }
      const generateCalls = requests.filter((request) => request.url.endsWith(":generateContent"));
      if (generateCalls.length === 1) {
        return Response.json({
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "calc",
                        args: { expression: "6*7" },
                        id: "toolu_vrtx_calc",
                      },
                    },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          },
          traceId: "trace-1",
        });
      }
      return Response.json({
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: "The answer is 42." }] } }],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 6 },
        },
      });
    }) as typeof fetch;

    const agentId = createAntigravityAgent("claude-sonnet-5-5-medium", ["calc"]);
    const result = await agentManager.execute(
      agentId,
      [{ role: "user", content: "Calculate 6*7 with the tool." }],
      { useTools: true, sessionId: `antigravity-loop-${crypto.randomUUID()}` }
    );

    expect(result.content).toBe("The answer is 42.");
    expect(result.tool_calls?.[0]?.name).toBe("calc");

    const setup = requests.filter((request) => request.url.endsWith("v1internal:loadCodeAssist"));
    expect(setup).toHaveLength(1);
    const generate = requests.filter((request) => request.url.endsWith(":generateContent"));
    expect(generate.map((request) => request.url)).toEqual([
      "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent",
      "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent",
    ]);
    expect(requests.some((request) => request.url.includes("generativelanguage"))).toBe(false);

    const first = generate[0];
    expect(first?.headers.get("Authorization")).toStartWith("Bearer ya29.routing-");
    expect(first?.headers.get("User-Agent")).toBe("antigravity");
    expect(first?.body).toMatchObject({
      project: "aicode-consumers",
      model: "claude-sonnet-5-5-medium",
      userAgent: "antigravity",
      requestType: "agent",
    });
    const firstRequest = first?.body.request as {
      tools?: { functionDeclarations?: Record<string, unknown>[] }[];
    };
    const declaration = firstRequest.tools?.[0]?.functionDeclarations?.[0];
    expect(declaration?.name).toBe("calc");
    expect(declaration).toHaveProperty("parametersJsonSchema");
    expect(declaration).not.toHaveProperty("parameters");

    const secondRequest = generate[1]?.body.request as {
      contents: { role: string; parts: Record<string, unknown>[] }[];
    };
    const toolTurn = secondRequest.contents.at(-1);
    expect(toolTurn?.role).toBe("user");
    expect(toolTurn?.parts[0]?.functionResponse).toMatchObject({
      id: "toolu_vrtx_calc",
      name: "calc",
    });
  });

  test("keeps Antigravity model ids that the public Gemini API aliases", async () => {
    const generateModels: unknown[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("v1internal:loadCodeAssist")) {
        return Response.json({ cloudaicompanionProject: "aicode-consumers" });
      }
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      generateModels.push(body.model);
      return Response.json({
        response: { candidates: [{ content: { parts: [{ text: "flash-ok" }] } }] },
      });
    }) as typeof fetch;

    const agentId = createAntigravityAgent("gemini-3-flash", []);
    const result = await agentManager.execute(agentId, [{ role: "user", content: "hi" }], {
      useTools: false,
      sessionId: `antigravity-alias-${crypto.randomUUID()}`,
    });

    expect(result.content).toBe("flash-ok");
    expect(generateModels).toEqual(["gemini-3-flash"]);
  });

  test("does not send chat requests when the account has no Cloud Code project", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ currentTier: { id: "free-tier" } });
    }) as typeof fetch;

    const agentId = createAntigravityAgent("claude-opus-5-5-medium", []);
    const result = await agentManager
      .execute(agentId, [{ role: "user", content: "hi" }], {
        useTools: false,
        sessionId: `antigravity-noproject-${crypto.randomUUID()}`,
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error: String(error) })
      );

    expect(urls.some((url) => url.endsWith(":generateContent"))).toBe(false);
    const surfaced = result.ok ? JSON.stringify(result.value) : result.error;
    expect(surfaced).toContain("no Cloud Code project");
  });
});
