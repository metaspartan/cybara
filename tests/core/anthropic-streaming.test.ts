import { describe, expect, test } from "bun:test";
import {
  anthropicTimingOptions,
  isAnthropicEventStream,
  parseAnthropicEventStream,
  postAnthropicStreamableMessages,
  readAnthropicMessageBody,
} from "../../src/core/llm/anthropic-streaming";

function sseEvent(eventName: string, payload: Record<string, unknown>): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

const FULL_STREAM = [
  sseEvent("message_start", {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "mimo-v2.6-pro",
      content: [],
      usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 4 },
    },
  }),
  sseEvent("ping", { type: "ping" }),
  sseEvent("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "" },
  }),
  sseEvent("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "Let me think" },
  }),
  sseEvent("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "signature_delta", signature: "sig-1" },
  }),
  sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
  sseEvent("content_block_start", {
    type: "content_block_start",
    index: 1,
    content_block: { type: "text", text: "" },
  }),
  sseEvent("content_block_delta", {
    type: "content_block_delta",
    index: 1,
    delta: { type: "text_delta", text: "Hello " },
  }),
  sseEvent("content_block_delta", {
    type: "content_block_delta",
    index: 1,
    delta: { type: "text_delta", text: "world" },
  }),
  sseEvent("content_block_stop", { type: "content_block_stop", index: 1 }),
  sseEvent("content_block_start", {
    type: "content_block_start",
    index: 2,
    content_block: { type: "tool_use", id: "call-1", name: "read", input: {} },
  }),
  sseEvent("content_block_delta", {
    type: "content_block_delta",
    index: 2,
    delta: { type: "input_json_delta", partial_json: '{"path":' },
  }),
  sseEvent("content_block_delta", {
    type: "content_block_delta",
    index: 2,
    delta: { type: "input_json_delta", partial_json: '"/tmp/a.png"}' },
  }),
  sseEvent("content_block_stop", { type: "content_block_stop", index: 2 }),
  sseEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "tool_use", stop_sequence: null },
    usage: { output_tokens: 21 },
  }),
  sseEvent("message_stop", { type: "message_stop" }),
].join("");

describe("anthropic event stream parsing", () => {
  test("reconstructs message content, usage, and timing from the stream", () => {
    const clock = [260, 470];
    let tick = 0;
    const nowMs = () => clock[Math.min(tick++, clock.length - 1)] ?? 470;

    const { message, timing } = parseAnthropicEventStream(FULL_STREAM, 40, nowMs);

    expect(message.id).toBe("msg_1");
    expect(message.role).toBe("assistant");
    expect(message.model).toBe("mimo-v2.6-pro");
    expect(message.content).toEqual([
      { type: "thinking", thinking: "Let me think", signature: "sig-1" },
      { type: "text", text: "Hello world" },
      { type: "tool_use", id: "call-1", name: "read", input: { path: "/tmp/a.png" } },
    ]);
    expect(message.usage).toEqual({
      input_tokens: 12,
      output_tokens: 21,
      cache_read_input_tokens: 4,
    });
    expect(timing.firstTokenMs).toBeGreaterThan(0);
    expect(timing.generationDurationMs).toBeGreaterThan(0);
  });

  test("measures first token from the first content-bearing delta", () => {
    const stream = [
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_2",
          model: "mimo-v2.6-pro",
          content: [],
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      }),
      sseEvent("ping", { type: "ping" }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      }),
      sseEvent("message_stop", { type: "message_stop" }),
    ].join("");
    const clock = [250, 350];
    let tick = 0;

    const { timing } = parseAnthropicEventStream(stream, 0, () => clock[tick++] ?? 350);

    expect(timing.firstTokenMs).toBe(250);
    expect(timing.generationDurationMs).toBe(100);
  });

  test("omits timing for streams without content", () => {
    const stream = [
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_3",
          model: "m",
          content: [],
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      }),
      sseEvent("message_stop", { type: "message_stop" }),
    ].join("");

    const { message, timing } = parseAnthropicEventStream(stream, 0, () => 100);

    expect(message.content).toEqual([]);
    expect(timing.firstTokenMs).toBeUndefined();
    expect(timing.generationDurationMs).toBeUndefined();
  });

  test("throws a clear error for mid-stream error events", () => {
    const stream = sseEvent("error", {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });
    expect(() => parseAnthropicEventStream(stream, 0)).toThrow(
      "Anthropic stream error: Overloaded"
    );
  });

  test("keeps multi-line data payloads and ignores comment lines", () => {
    const stream = [
      ": keep-alive\n",
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_4",
          model: "m",
          content: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
      'event: content_block_delta\ndata: {"type":"content_block_delta",\ndata: "index":0,"delta":{"type":"text_delta","text":"ab"}}\n\n',
      sseEvent("message_stop", { type: "message_stop" }),
    ].join("");

    const { message } = parseAnthropicEventStream(stream, 0, () => 0);

    expect(message.content).toEqual([{ type: "text", text: "ab" }]);
  });

  test("falls back to empty tool input for malformed partial JSON", () => {
    const stream = [
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call-2", name: "exec", input: {} },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "{not json" },
      }),
      sseEvent("message_stop", { type: "message_stop" }),
    ].join("");

    const { message } = parseAnthropicEventStream(stream, 0, () => 0);

    expect(message.content[0]).toEqual({ type: "tool_use", id: "call-2", name: "exec", input: {} });
  });
});

describe("anthropic response reading", () => {
  test("detects event stream responses", () => {
    expect(
      isAnthropicEventStream(new Response("", { headers: { "content-type": "text/event-stream" } }))
    ).toBe(true);
    expect(
      isAnthropicEventStream(new Response("", { headers: { "content-type": "application/json" } }))
    ).toBe(false);
  });

  test("reads plain JSON responses with empty timing", async () => {
    const payload = {
      id: "msg_json",
      type: "message",
      role: "assistant",
      model: "m",
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 3, output_tokens: 2 },
    };
    const read = await readAnthropicMessageBody(
      new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }),
      0
    );
    expect(read.message).toEqual(payload);
    expect(read.timing).toEqual({});
  });

  test("reads event stream responses with chunk arrival timing", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseEvent("message_start", {
              type: "message_start",
              message: {
                id: "msg_r",
                model: "m",
                content: [],
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            })
          )
        );
        controller.enqueue(
          encoder.encode(
            sseEvent("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Hi there" },
            })
          )
        );
        controller.enqueue(encoder.encode(sseEvent("message_stop", { type: "message_stop" })));
        controller.close();
      },
    });
    const clock = [10, 210, 510, 900];
    let tick = 0;

    const read = await readAnthropicMessageBody(
      new Response(stream, { headers: { "content-type": "text/event-stream" } }),
      0,
      () => clock[tick++] ?? 900
    );

    expect(read.message.content).toEqual([{ type: "text", text: "Hi there" }]);
    expect(read.timing.firstTokenMs).toBe(210);
    expect(read.timing.generationDurationMs).toBe(300);
  });

  test("maps timing into trackTokenUsage options with duration fallback", () => {
    expect(anthropicTimingOptions({ firstTokenMs: 120, generationDurationMs: 400 }, 900)).toEqual({
      firstTokenMs: 120,
      generationDurationMs: 400,
    });
    expect(anthropicTimingOptions({}, 900)).toEqual({ generationDurationMs: 900 });
    expect(anthropicTimingOptions({ firstTokenMs: 120 }, 900)).toEqual({
      firstTokenMs: 120,
      generationDurationMs: 900,
    });
    expect(anthropicTimingOptions({ firstTokenMs: 890, generationDurationMs: 2 }, 900)).toEqual({
      firstTokenMs: 890,
      generationDurationMs: 900,
    });
  });
});

describe("streamable anthropic posting", () => {
  test("requests streaming and falls back only when the provider rejects the stream flag", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let call = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      call += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (call === 1) {
        return new Response('{"error":"stream parameter is not supported"}', { status: 400 });
      }
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const response = await postAnthropicStreamableMessages(
      "https://proxy.example.com/v1",
      "/messages",
      { model: "m", messages: [] },
      { headers: { "x-api-key": "k" } },
      fetchImpl
    );

    expect(response.ok).toBe(true);
    expect(call).toBe(2);
    expect(bodies[0]?.stream).toBe(true);
    expect(bodies[1]?.stream).toBeUndefined();
  });

  test("replays non-stream rejections so error handling still sees the original failure", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('{"error":"invalid model"}', {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const response = await postAnthropicStreamableMessages(
      "https://proxy.example.com/v1",
      "/messages",
      { model: "m", messages: [] },
      { headers: { "x-api-key": "k" } },
      fetchImpl
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"error":"invalid model"}');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.stream).toBe(true);
  });
});
