import { describe, expect, test } from "bun:test";
import {
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
      ((properties.options?.properties as Record<string, Record<string, unknown>>).enabled || {}).type
    ).toBe("boolean");
    expect(properties.targets?.type).toBe("array");
    expect((properties.targets?.items as Record<string, unknown>).type).toBe("string");
    expect(properties.variant?.type).toBeUndefined();
    expect(((properties.variant?.oneOf as Record<string, unknown>[])[0] || {}).type).toBe("string");
    expect((schema.properties.mode as Record<string, unknown>).type).toBeUndefined();
  });
});
