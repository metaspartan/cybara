import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { createStreamWatchdog } from "../../src/core/llm/stream-watchdog";
import { consumeOpenAIChatStream } from "../../src/core/llm/streaming-completions";
import {
  compactCodexInputItemsForContext,
  sanitizeCodexInputItems,
} from "../../src/core/llm/codex-context";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

function sseChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentDelta(text: string): string {
  return sseChunk({ choices: [{ index: 0, delta: { content: text } }] });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let scriptedTurns: Array<(body: Record<string, unknown>) => Response | Promise<Response>> = [];
let observedBodies: Array<Record<string, unknown>> = [];

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch: async (req) => {
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/chat/completions")) {
      return new Response("not found", { status: 404 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    observedBodies.push(body);
    const model = String(body.model || "");

    if (model === "behave-normal") {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(contentDelta("Hello ")));
          await sleep(10);
          controller.enqueue(encoder.encode(contentDelta("world")));
          controller.enqueue(
            encoder.encode(
              sseChunk({
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_1",
                          function: {
                            name: "calc",
                            arguments: '{"expression"',
                          },
                        },
                      ],
                    },
                  },
                ],
              })
            )
          );
          controller.enqueue(
            encoder.encode(
              sseChunk({
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [{ index: 0, function: { arguments: ':"1+1"}' } }],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              })
            )
          );
          controller.enqueue(
            encoder.encode(
              sseChunk({
                choices: [],
                usage: { prompt_tokens: 7, completion_tokens: 3 },
              })
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (model === "behave-silent") {
      const stream = new ReadableStream<Uint8Array>({ start() {} });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (model === "behave-empty-heartbeats") {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          for (let index = 0; index < 10; index += 1) {
            controller.enqueue(encoder.encode(sseChunk({ choices: [{ index: 0, delta: {} }] })));
            await sleep(40);
          }
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (model === "behave-usage-heartbeats") {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          for (let index = 0; index < 6; index += 1) {
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  choices: [],
                  usage: { prompt_tokens: index + 1, completion_tokens: 0 },
                })
              )
            );
            await sleep(80);
          }
          controller.enqueue(encoder.encode(contentDelta("late output")));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (model === "behave-midstream-stall") {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(contentDelta("partial ")));
          controller.enqueue(encoder.encode(contentDelta("output")));
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (model === "behave-slow-but-alive") {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          for (let i = 0; i < 12; i++) {
            controller.enqueue(encoder.encode(contentDelta(`t${i} `)));
            await sleep(60);
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (model === "behave-reasoning-keepalive") {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          for (let index = 0; index < 6; index += 1) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            await sleep(80);
          }
          controller.enqueue(encoder.encode(contentDelta("done reasoning")));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    if (model === "behave-scripted") {
      const turn = scriptedTurns.shift();
      if (!turn) {
        return new Response(JSON.stringify({ error: "no scripted turn left" }), { status: 500 });
      }
      return await turn(body);
    }

    return new Response(JSON.stringify({ error: `unknown behavior ${model}` }), { status: 400 });
  },
});

const baseUrl = `http://127.0.0.1:${server.port}/v1`;

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];

afterEach(() => {
  scriptedTurns = [];
  observedBodies = [];
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
});

afterAll(() => {
  server.stop(true);
});

async function fetchStreaming(
  model: string,
  watchdogOpts: Parameters<typeof createStreamWatchdog>[0]
) {
  const watchdog = createStreamWatchdog(watchdogOpts);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: watchdog.signal,
    });
    const assembled = await consumeOpenAIChatStream(response.body!, watchdog);
    watchdog.dispose();
    return assembled;
  } catch (error) {
    watchdog.dispose();
    throw watchdog.wrapError(error);
  }
}

describe("consumeOpenAIChatStream onTextDelta", () => {
  test("invokes onTextDelta for each content delta in order (powers live streaming + TTFT)", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(contentDelta("Hel")));
        controller.enqueue(encoder.encode(contentDelta("lo")));
        controller.enqueue(
          encoder.encode(
            sseChunk({
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const deltas: string[] = [];
    const startedAt = performance.now() - 25;
    const assembled = await consumeOpenAIChatStream(
      stream,
      undefined,
      (delta) => deltas.push(delta),
      startedAt
    );
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(assembled.choices[0]?.message.content).toBe("Hello");
    expect(assembled.first_token_ms).toBeGreaterThanOrEqual(20);
  });

  test("measures generation duration across distinct output events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(contentDelta("Hel")));
        setTimeout(() => {
          controller.enqueue(encoder.encode(contentDelta("lo")));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }, 25);
      },
    });
    const assembled = await consumeOpenAIChatStream(
      stream,
      undefined,
      undefined,
      performance.now()
    );
    expect(assembled.choices[0]?.message.content).toBe("Hello");
    expect(assembled.generation_duration_ms).toBeGreaterThanOrEqual(15);
  });
});

describe("LLM stream watchdog (inactivity, not duration)", () => {
  test("assembles content, tool calls, and usage from a streamed completion", async () => {
    const result = await fetchStreaming("behave-normal", {
      firstChunkMs: 2000,
      stallMs: 2000,
    });
    const message = result.choices[0]!.message;
    expect(message.content).toBe("Hello world");
    expect(message.tool_calls?.[0]?.function.name).toBe("calc");
    expect(message.tool_calls?.[0]?.function.arguments).toBe('{"expression":"1+1"}');
    expect(result.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3 });
  });

  test("a provider that never produces output trips the first-token timeout", async () => {
    const startedAt = Date.now();
    await expect(
      fetchStreaming("behave-silent", { firstChunkMs: 150, stallMs: 0 })
    ).rejects.toThrow(/no first token/i);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  test("empty heartbeat events do not keep a stalled provider alive", async () => {
    await expect(
      fetchStreaming("behave-empty-heartbeats", {
        firstChunkMs: 150,
        stallMs: 150,
      })
    ).rejects.toThrow(/no first token/i);
  });

  test("SSE comment keep-alives cannot bypass the first-token deadline", async () => {
    await expect(
      fetchStreaming("behave-reasoning-keepalive", {
        firstChunkMs: 200,
        stallMs: 200,
      })
    ).rejects.toThrow(/no first token/i);
  });

  test("usage events cannot bypass the first-token deadline", async () => {
    await expect(
      fetchStreaming("behave-usage-heartbeats", {
        firstChunkMs: 200,
        stallMs: 200,
      })
    ).rejects.toThrow(/no first token/i);
  });

  test("a mid-stream stall trips the stall timeout — the exact 07e1bb failure", async () => {
    await expect(
      fetchStreaming("behave-midstream-stall", {
        firstChunkMs: 2000,
        stallMs: 200,
      })
    ).rejects.toThrow(/stalled/i);
  });

  test("a slow-but-alive stream outlives the stall window because chunks reset it", async () => {
    const result = await fetchStreaming("behave-slow-but-alive", {
      firstChunkMs: 2000,
      stallMs: 250,
    });
    expect(result.choices[0]!.message.content).toContain("t11");
  });

  test("a caller abort (user steer) is not rewritten as a watchdog timeout", async () => {
    const caller = new AbortController();
    setTimeout(() => caller.abort(), 50);
    const watchdog = createStreamWatchdog({
      firstChunkMs: 5000,
      stallMs: 5000,
      callerSignal: caller.signal,
    });
    let thrown: unknown;
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "behave-silent",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: watchdog.signal,
      });
      await consumeOpenAIChatStream(response.body!, watchdog);
    } catch (error) {
      thrown = watchdog.wrapError(error);
    } finally {
      watchdog.dispose();
    }
    expect(watchdog.timedOutReason()).toBeNull();
    expect(String((thrown as Error)?.message || thrown)).not.toMatch(/stalled|no first token/i);
  });
});

describe("agentic loop stability against a real streaming provider", () => {
  function createLoopAgent(model: string) {
    const provider = providerManager.create({
      provider: "openai",
      name: "Watchdog Loop Provider",
      api_key: "test-key",
      base_url: baseUrl,
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Watchdog Loop Agent",
      type: "main",
      provider_id: provider.id,
      model,
      system_prompt: "test",
      tools: ["calc"],
    });
    createdAgentIds.push(agent.id);
    return agent;
  }

  function streamedToolCallTurn(preamble = ""): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (preamble) controller.enqueue(encoder.encode(contentDelta(preamble)));
        controller.enqueue(
          encoder.encode(
            sseChunk({
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_calc",
                        function: {
                          name: "calc",
                          arguments: '{"expression":"2+2"}',
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            })
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  function streamedTextTurn(text: string): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(contentDelta(text)));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  test("empty final message after a tool round is recovered by the closing nudge", async () => {
    const agent = createLoopAgent("behave-scripted");
    scriptedTurns = [
      () => streamedToolCallTurn(),
      () => streamedTextTurn(""),
      () => streamedTextTurn("The result of 2+2 is 4."),
    ];

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "what is 2+2? use the calc tool" }],
      { useTools: true, sessionId: "watchdog-nudge-session" }
    );

    expect(result.tool_calls?.map((call) => call.name)).toContain("calc");
    expect(result.content).toContain("4");
    expect(result.content).not.toMatch(/completed.*tool/i);
    expect(observedBodies.length).toBe(3);
    const nudgeBody = observedBodies[2]!;
    expect(JSON.stringify(nudgeBody.messages)).toContain("Do not call any more tools");
  });

  test("tool-call narration cannot replace an empty final answer", async () => {
    const agent = createLoopAgent("behave-scripted");
    scriptedTurns = [
      () => streamedToolCallTurn("I'll check that."),
      () => streamedTextTurn(""),
      () => streamedTextTurn("The checked result is 4."),
    ];

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "can you check what 2+2 is?" }],
      { useTools: true, sessionId: "watchdog-preamble-nudge-session" }
    );

    expect(result.content).toBe("The checked result is 4.");
    expect(result.content).not.toBe("I'll check that.");
    expect(result.tool_calls?.map((call) => call.name)).toContain("calc");
    expect(observedBodies.length).toBe(3);
  });

  test("provider that rejects streaming falls back to a plain request", async () => {
    const agent = createLoopAgent("behave-scripted");
    scriptedTurns = [
      (body) =>
        body.stream === true
          ? new Response(JSON.stringify({ error: { message: "stream is not supported" } }), {
              status: 400,
            })
          : new Response(
              JSON.stringify({
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "plain-json-ok" },
                    finish_reason: "stop",
                  },
                ],
              }),
              { headers: { "Content-Type": "application/json" } }
            ),
      (body) =>
        body.stream === true
          ? new Response(JSON.stringify({ error: { message: "stream is not supported" } }), {
              status: 400,
            })
          : new Response(
              JSON.stringify({
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "plain-json-ok" },
                    finish_reason: "stop",
                  },
                ],
              }),
              { headers: { "Content-Type": "application/json" } }
            ),
    ];

    const result = await agentManager.execute(agent.id, [{ role: "user", content: "hello" }], {
      useTools: false,
      sessionId: "watchdog-fallback-session",
    });
    expect(result.content).toBe("plain-json-ok");
  });

  test("an incomplete stream recovers with a plain completion", async () => {
    const agent = createLoopAgent("behave-scripted");
    scriptedTurns = [
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(contentDelta("Let")));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        ),
      (body) => {
        expect(body.stream).toBeUndefined();
        return new Response(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Let me inspect that with the tools." },
                finish_reason: "stop",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      },
    ];

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "inspect the workspace" }],
      { useTools: false, sessionId: "incomplete-stream-recovery-session" }
    );

    expect(result.content).toBe("Let me inspect that with the tools.");
    expect(observedBodies).toHaveLength(2);
  });
});

describe("Codex transcript compaction keeps long runs under context budget", () => {
  test("elides old tool results in place, preserving pairing and the leading request", () => {
    const items: Array<Record<string, unknown>> = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "review the repo" }],
      },
    ];
    for (let i = 0; i < 200; i++) {
      items.push({
        type: "function_call",
        call_id: `c${i}`,
        name: "read",
        arguments: "{}",
      });
      items.push({
        type: "function_call_output",
        call_id: `c${i}`,
        output: "x".repeat(2000),
      });
    }
    const before = items.length;
    compactCodexInputItemsForContext(items, 50_000);

    const totalChars = items.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
    expect(totalChars).toBeLessThanOrEqual(50_000);
    expect(items.length).toBe(before);
    expect(JSON.stringify(items[0])).toContain("review the repo");
    expect(items[items.length - 1].output).toBe("x".repeat(2000));
    expect(JSON.stringify(items)).toContain("elided to free context");
    const liveCallIds = new Set(
      items.filter((i) => i.type === "function_call").map((i) => i.call_id as string)
    );
    for (const item of items) {
      if (item.type === "function_call_output") {
        expect(liveCallIds.has(item.call_id as string)).toBe(true);
      }
    }
  });

  test("is a no-op when already under budget", async () => {
    const items: Array<Record<string, unknown>> = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
      { type: "function_call", call_id: "c0", name: "read", arguments: "{}" },
      { type: "function_call_output", call_id: "c0", output: "small" },
    ];
    const before = items.length;
    compactCodexInputItemsForContext(items, 1_000_000);
    expect(items.length).toBe(before);
  });
});

describe("Codex input sanitizer guarantees call/output pairing", () => {
  test("drops an orphaned output whose call was never present", () => {
    const items: Array<Record<string, unknown>> = [
      { role: "user", content: [{ type: "input_text", text: "go" }] },
      { type: "function_call", call_id: "a", name: "read", arguments: "{}" },
      { type: "function_call_output", call_id: "a", output: "ok" },
      { type: "function_call_output", call_id: "ghost", output: "orphan" },
    ];
    const result = sanitizeCodexInputItems(items);
    expect(result.droppedOutputs).toBe(1);
    expect(items.some((i) => i.call_id === "ghost")).toBe(false);
    expect(items.some((i) => i.type === "function_call_output" && i.call_id === "a")).toBe(true);
  });

  test("drops a duplicate output for the same call", () => {
    const items: Array<Record<string, unknown>> = [
      { type: "function_call", call_id: "a", name: "read", arguments: "{}" },
      { type: "function_call_output", call_id: "a", output: "first" },
      { type: "function_call_output", call_id: "a", output: "dup" },
    ];
    const result = sanitizeCodexInputItems(items);
    expect(result.droppedOutputs).toBe(1);
    expect(items.filter((i) => i.type === "function_call_output").length).toBe(1);
  });

  test("leaves a valid paired transcript untouched", () => {
    const items: Array<Record<string, unknown>> = [
      { type: "function_call", call_id: "a", name: "read", arguments: "{}" },
      { type: "function_call_output", call_id: "a", output: "ok" },
      { type: "function_call", call_id: "b", name: "exec", arguments: "{}" },
      { type: "function_call_output", call_id: "b", output: "ok" },
    ];
    const before = items.length;
    const result = sanitizeCodexInputItems(items);
    expect(result.droppedOutputs).toBe(0);
    expect(items.length).toBe(before);
  });

  test("compaction output stays sanitizer-clean (no orphans introduced)", () => {
    const items: Array<Record<string, unknown>> = [
      { role: "user", content: [{ type: "input_text", text: "review" }] },
    ];
    for (let i = 0; i < 200; i++) {
      items.push({
        type: "function_call",
        call_id: `c${i}`,
        name: "read",
        arguments: "{}",
      });
      items.push({
        type: "function_call_output",
        call_id: `c${i}`,
        output: "x".repeat(2000),
      });
    }
    compactCodexInputItemsForContext(items, 50_000);
    const result = sanitizeCodexInputItems(items);
    expect(result.droppedOutputs).toBe(0);
  });
});
