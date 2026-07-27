import { describe, expect, test } from "bun:test";
import {
  applyMoonshotRequestOptions,
  normalizeKimiCompatibleAssistantToolMessage,
  normalizeKimiAssistantToolMessage,
  normalizeKimiToolSchema,
} from "../../src/core/llm/kimi-wire";

describe("Kimi wire normalization", () => {
  test("omits empty assistant content when replaying tool calls", () => {
    const toolCalls = [{ id: "call-1", type: "function" }];
    expect(
      normalizeKimiAssistantToolMessage({
        role: "assistant",
        content: "",
        reasoning_content: "checked the repository",
        tool_calls: toolCalls,
      })
    ).toEqual({
      role: "assistant",
      reasoning_content: "checked the repository",
      tool_calls: toolCalls,
    });
    expect(
      normalizeKimiAssistantToolMessage({
        role: "assistant",
        content: "I will inspect it.",
        tool_calls: toolCalls,
      })
    ).toEqual({
      role: "assistant",
      content: "I will inspect it.",
      tool_calls: toolCalls,
    });
  });

  test("preserves Moonshot interleaved reasoning fields across tool turns", () => {
    const toolCalls = [{ id: "call-1", type: "function" }];
    expect(
      normalizeKimiCompatibleAssistantToolMessage(
        { role: "assistant", content: null, tool_calls: toolCalls },
        "moonshot",
        "kimi-k3"
      )
    ).toEqual({
      role: "assistant",
      content: null,
      reasoning_content: "",
      tool_calls: toolCalls,
    });
  });

  test("normalizes Moonshot always-thinking request options", () => {
    const k3Body: Record<string, unknown> = {
      reasoning_effort: "high",
      temperature: 0.2,
      top_p: 0.8,
      tool_choice: { type: "function", function: { name: "read" } },
    };
    applyMoonshotRequestOptions(k3Body, "moonshot", "kimi-k3");
    expect(k3Body.reasoning_effort).toBe("high");
    expect(k3Body.temperature).toBeUndefined();
    expect(k3Body.top_p).toBeUndefined();
    expect(k3Body.tool_choice).toEqual({ type: "function", function: { name: "read" } });

    const codeBody: Record<string, unknown> = {
      reasoning_effort: "high",
      temperature: 0.2,
      tool_choice: { type: "function", function: { name: "read" } },
    };
    applyMoonshotRequestOptions(codeBody, "moonshot", "kimi-k2.7-code");
    expect(codeBody.reasoning_effort).toBeUndefined();
    expect(codeBody.temperature).toBeUndefined();
    expect(codeBody.tool_choice).toBe("auto");
  });

  test("adds explicit types to strict nested tool schemas without mutating input", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { enum: ["quick", "full"] },
        retries: { const: 3 },
        options: {
          properties: {
            enabled: { enum: [true, false] },
          },
        },
        targets: {
          items: { enum: ["web", "mobile"] },
        },
        variant: {
          oneOf: [{ enum: ["a", "b"] }, { type: "number" }],
        },
      },
    };

    const normalized = normalizeKimiToolSchema(schema);
    const properties = normalized.properties as Record<string, Record<string, unknown>>;
    expect(properties.mode?.type).toBe("string");
    expect(properties.retries?.type).toBe("integer");
    expect(properties.options?.type).toBe("object");
    expect(
      ((properties.options?.properties as Record<string, Record<string, unknown>>).enabled || {})
        .type
    ).toBe("boolean");
    expect(properties.targets?.type).toBe("array");
    expect((properties.targets?.items as Record<string, unknown>).type).toBe("string");
    expect(properties.variant?.type).toBeUndefined();
    expect(((properties.variant?.oneOf as Record<string, unknown>[])[0] || {}).type).toBe("string");
    expect((schema.properties.mode as Record<string, unknown>).type).toBeUndefined();
  });
});
