import { describe, expect, test } from "bun:test";
import {
  ANTIGRAVITY_CLOUDCODE_BASE_URL,
  antigravityGenerateContentUrl,
  antigravityProjectIdFrom,
  antigravityTransportBaseUrl,
  bearerTokenFromHeaders,
  isAntigravityCloudCodeBaseUrl,
  resolveAntigravityProject,
  unwrapAntigravityResponse,
  wrapAntigravityRequest,
} from "../../../src/core/llm/antigravity-cloudcode";
import { googleFunctionDeclaration } from "../../../src/core/llm/google-tool-schema";
import { toGoogleHistory } from "../../../src/core/llm/provider-history";

const uniqueToken = (): string => `ya29.test-${crypto.randomUUID()}`;

describe("antigravityTransportBaseUrl", () => {
  test("moves saved Antigravity providers off the public Gemini host", () => {
    expect(
      antigravityTransportBaseUrl("antigravity", "https://generativelanguage.googleapis.com/v1beta")
    ).toBe(ANTIGRAVITY_CLOUDCODE_BASE_URL);
    expect(antigravityTransportBaseUrl("google-antigravity", "")).toBe(
      ANTIGRAVITY_CLOUDCODE_BASE_URL
    );
  });

  test("keeps explicit custom endpoints and other providers untouched", () => {
    expect(antigravityTransportBaseUrl("antigravity", "https://proxy.example/v1")).toBe(
      "https://proxy.example/v1"
    );
    expect(
      antigravityTransportBaseUrl("google", "https://generativelanguage.googleapis.com/v1beta")
    ).toBe("https://generativelanguage.googleapis.com/v1beta");
  });
});

describe("Cloud Code request shape", () => {
  test("recognizes only Cloud Code hosts", () => {
    expect(isAntigravityCloudCodeBaseUrl("https://daily-cloudcode-pa.googleapis.com")).toBe(true);
    expect(isAntigravityCloudCodeBaseUrl("https://cloudcode-pa.googleapis.com/")).toBe(true);
    expect(isAntigravityCloudCodeBaseUrl("https://cloudcode-pa.googleapis.com.evil.example")).toBe(
      false
    );
    expect(isAntigravityCloudCodeBaseUrl("https://generativelanguage.googleapis.com")).toBe(false);
    expect(isAntigravityCloudCodeBaseUrl("not a url")).toBe(false);
  });

  test("targets the generateContent method on the endpoint origin", () => {
    expect(antigravityGenerateContentUrl("https://daily-cloudcode-pa.googleapis.com/x/y")).toBe(
      "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent"
    );
  });

  test("wraps the Gemini request and unwraps the response envelope", () => {
    const wrapped = wrapAntigravityRequest("proj-1", "claude-sonnet-5-5-medium", {
      contents: [],
    });
    expect(wrapped).toMatchObject({
      project: "proj-1",
      model: "claude-sonnet-5-5-medium",
      request: { contents: [] },
      userAgent: "antigravity",
      requestType: "agent",
    });
    expect(String(wrapped.requestId)).toMatch(/^agent-[0-9a-f-]{36}$/);
    expect(unwrapAntigravityResponse({ response: { candidates: [] }, traceId: "t" })).toEqual({
      candidates: [],
    });
    expect(unwrapAntigravityResponse({ candidates: [] })).toEqual({ candidates: [] });
  });

  test("extracts bearer tokens and project ids defensively", () => {
    expect(bearerTokenFromHeaders({ Authorization: "Bearer abc" })).toBe("abc");
    expect(bearerTokenFromHeaders({ "x-goog-api-key": "abc" })).toBeUndefined();
    expect(antigravityProjectIdFrom({ cloudaicompanionProject: " p1 " })).toBe("p1");
    expect(antigravityProjectIdFrom({ cloudaicompanionProject: { id: "p2" } })).toBe("p2");
    expect(antigravityProjectIdFrom({ currentTier: {} })).toBeUndefined();
    expect(antigravityProjectIdFrom(null)).toBeUndefined();
  });
});

describe("resolveAntigravityProject", () => {
  test("loads the project once per token and reuses it", async () => {
    let calls = 0;
    const fetcher = async (): Promise<Response> => {
      calls += 1;
      return Response.json({ cloudaicompanionProject: "aicode-consumers" });
    };
    const token = uniqueToken();
    expect(await resolveAntigravityProject(token, fetcher)).toBe("aicode-consumers");
    expect(await resolveAntigravityProject(token, fetcher)).toBe("aicode-consumers");
    expect(calls).toBe(1);
  });

  test("fails closed when the account has no project or setup is rejected", async () => {
    await expect(
      resolveAntigravityProject(uniqueToken(), async () => Response.json({ currentTier: {} }))
    ).rejects.toThrow("no Cloud Code project");
    await expect(
      resolveAntigravityProject(uniqueToken(), async () => new Response("denied", { status: 403 }))
    ).rejects.toThrow("403");
  });
});

describe("tool call ids and schemas for Cloud Code", () => {
  const history = [
    { role: "user" as const, content: "read it" },
    {
      role: "assistant" as const,
      content: "",
      tool_calls: [{ id: "toolu_1", name: "read", arguments: { path: "a.txt" } }],
    },
    { role: "tool" as const, content: "hello", tool_call_id: "toolu_1" },
  ];

  test("replays tool call ids only when requested", () => {
    const withIds = toGoogleHistory(history, { includeToolCallIds: true });
    expect(withIds[1]?.parts?.[0]?.functionCall?.id).toBe("toolu_1");
    expect(withIds[2]?.parts?.[0]?.functionResponse?.id).toBe("toolu_1");
    const withoutIds = toGoogleHistory(history);
    expect(withoutIds[1]?.parts?.[0]?.functionCall?.id).toBeUndefined();
    expect(withoutIds[2]?.parts?.[0]?.functionResponse?.id).toBeUndefined();
  });

  test("can force JSON Schema declarations for anyOf parameters", () => {
    const tool = {
      name: "read",
      description: "Read",
      input_schema: {
        type: "object",
        properties: { path: { anyOf: [{ type: "string" }, { type: "array" }] } },
      },
    };
    expect(googleFunctionDeclaration(tool)).toHaveProperty("parameters");
    expect(googleFunctionDeclaration(tool, { forceJsonSchema: true })).toHaveProperty(
      "parametersJsonSchema"
    );
  });
});
