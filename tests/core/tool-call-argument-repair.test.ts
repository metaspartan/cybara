import { describe, expect, test } from "bun:test";
import {
  isUpstreamJsonDecodeError,
  parseToolCallArguments,
  repairJsonLikeText,
  serializeToolCallArguments,
} from "../../src/core/llm/tool-call-argument-repair";
import {
  countUnserializableToolCallArguments,
  shouldRetryByRepairingToolCallArguments,
  toRepairedToolCallArgumentsRequestBody,
} from "../../src/core/llm/tool-call-argument-compat";
import { toOpenAIChatMessage } from "../../src/core/llm/provider-history";
import type { AgentMessage } from "../../src/core/agent";

function bodyWith(args: unknown): Record<string, unknown> {
  return {
    model: "deepseek-v4-flash-vision-exp",
    messages: [
      { role: "system", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: args } }],
      },
      { role: "tool", tool_call_id: "c1", content: "ok" },
    ],
  };
}

describe("tool call argument repair", () => {
  test("repairs the single-quoted payload that a provider rejects with 400", () => {
    expect(parseToolCallArguments("{'path':'a.ts'}")).toEqual({ path: "a.ts" });
  });

  test("repairs a python literal repr", () => {
    expect(parseToolCallArguments("{'ok': True, 'n': None}")).toEqual({ ok: true, n: null });
  });

  test("repairs smart quotes", () => {
    expect(parseToolCallArguments("{‘path’:“a.ts”}")).toEqual({ path: "a.ts" });
  });

  test("repairs bare keys and trailing commas", () => {
    expect(parseToolCallArguments("{path: 'a.ts',}")).toEqual({ path: "a.ts" });
  });

  test("never corrupts already-valid arguments", () => {
    const valid = {
      path: "src/app.ts",
      nested: { keep: "it's fine", quote: 'say "hi"' },
      list: [1, 2, 3],
      flag: false,
      nil: null,
    };
    const serialized = JSON.stringify(valid);
    expect(serializeToolCallArguments(serialized)).toBe(serialized);
    expect(parseToolCallArguments(serialized)).toEqual(valid);
  });

  test("preserves an apostrophe inside a valid double-quoted string", () => {
    const serialized = '{"note":"it\'s a test"}';
    expect(parseToolCallArguments(serialized)).toEqual({ note: "it's a test" });
  });

  test("preserves escaped quotes and backslashes in valid payloads", () => {
    const valid = { path: "C:\\dir\\file.ts", text: 'he said "hi"' };
    const serialized = JSON.stringify(valid);
    expect(parseToolCallArguments(serialized)).toEqual(valid);
    expect(serializeToolCallArguments(serialized)).toBe(serialized);
  });

  test("degrades to an empty object rather than emitting invalid JSON", () => {
    const serialized = serializeToolCallArguments("<<not json at all>>");
    expect(serialized).toBe("{}");
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  test("always emits parseable output", () => {
    for (const raw of ["", "   ", "a.ts", "'", "{'k':'v'}", '{"a":1,}']) {
      expect(() => JSON.parse(serializeToolCallArguments(raw))).not.toThrow();
    }
  });

  test("treats absent and null arguments as an empty object", () => {
    expect(parseToolCallArguments(null)).toEqual({});
    expect(parseToolCallArguments(undefined)).toEqual({});
    expect(serializeToolCallArguments(null)).toBe("{}");
  });

  test("leaves non-string objects untouched", () => {
    const value = { path: "a.ts" };
    expect(parseToolCallArguments(value)).toBe(value);
  });

  test("does not turn a JSON array into an object", () => {
    expect(parseToolCallArguments("[1,2,3]")).toEqual({});
  });

  test("repairJsonLikeText is idempotent on already-valid JSON", () => {
    const valid = '{"path":"a.ts"}';
    expect(repairJsonLikeText(valid)).toBe(valid);
  });
});

describe("provider JSON decode error detection", () => {
  test("recognises the exact vLLM fingerprint from the report", () => {
    expect(isUpstreamJsonDecodeError("Expecting value: line 1 column 2 (char 1)")).toBe(true);
    expect(
      isUpstreamJsonDecodeError(
        "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"
      )
    ).toBe(true);
  });

  test("does not match unrelated provider errors", () => {
    expect(isUpstreamJsonDecodeError("rate limit exceeded")).toBe(false);
    expect(isUpstreamJsonDecodeError("model not found")).toBe(false);
  });
});

describe("self-healing retry for malformed tool call arguments", () => {
  test("retries when the provider rejects malformed arguments we sent", () => {
    const body = bodyWith("{'path':'a.ts'}");
    expect(countUnserializableToolCallArguments(body)).toBe(1);
    expect(
      shouldRetryByRepairingToolCallArguments(
        400,
        "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)",
        body
      )
    ).toBe(true);
  });

  test("does not retry when our payload is already valid", () => {
    const body = bodyWith('{"path":"a.ts"}');
    expect(countUnserializableToolCallArguments(body)).toBe(0);
    expect(
      shouldRetryByRepairingToolCallArguments(
        400,
        "Expecting value: line 1 column 2 (char 1)",
        body
      )
    ).toBe(false);
  });

  test("does not retry on unrelated 400s", () => {
    expect(
      shouldRetryByRepairingToolCallArguments(400, "context length exceeded", bodyWith("{'a':1}"))
    ).toBe(false);
  });

  test("does not retry on 500s", () => {
    expect(
      shouldRetryByRepairingToolCallArguments(
        500,
        "Expecting value: line 1 column 2 (char 1)",
        bodyWith("{'a':1}")
      )
    ).toBe(false);
  });

  test("the repaired body is accepted by a strict JSON parser", () => {
    const repaired = toRepairedToolCallArgumentsRequestBody(bodyWith("{'path':'a.ts'}"));
    expect(countUnserializableToolCallArguments(repaired)).toBe(0);
    const messages = repaired.messages as Array<Record<string, unknown>>;
    const assistant = messages[1] as { tool_calls: Array<{ function: { arguments: string } }> };
    expect(JSON.parse(assistant.tool_calls[0]!.function.arguments)).toEqual({ path: "a.ts" });
  });

  test("repairs only the broken call and preserves a valid sibling", () => {
    const body: Record<string, unknown> = {
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "a", type: "function", function: { name: "read", arguments: "{'path':'a'}" } },
            { id: "b", type: "function", function: { name: "read", arguments: '{"path":"b"}' } },
          ],
        },
      ],
    };
    const repaired = toRepairedToolCallArgumentsRequestBody(body);
    const messages = repaired.messages as Array<Record<string, unknown>>;
    const assistant = messages[0] as { tool_calls: Array<{ function: { arguments: string } }> };
    expect(assistant.tool_calls[0]!.function.arguments).toBe('{"path":"a"}');
    expect(assistant.tool_calls[1]!.function.arguments).toBe('{"path":"b"}');
  });
});

describe("wire serialization never emits unparseable arguments", () => {
  test("an assistant turn with malformed stored arguments serializes cleanly", () => {
    const message: AgentMessage = {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", name: "read", arguments: { path: "a.ts" } }],
    };
    const converted = toOpenAIChatMessage(message) as {
      tool_calls: Array<{ function: { arguments: string } }>;
    };
    expect(() => JSON.parse(converted.tool_calls[0]!.function.arguments)).not.toThrow();
  });

  test("a string-valued arguments payload is repaired before it reaches the provider", () => {
    const message = {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", name: "read", arguments: "{'path':'a.ts'}" }],
    } as unknown as AgentMessage;
    const converted = toOpenAIChatMessage(message) as {
      tool_calls: Array<{ function: { arguments: string } }>;
    };
    expect(JSON.parse(converted.tool_calls[0]!.function.arguments)).toEqual({ path: "a.ts" });
  });
});
