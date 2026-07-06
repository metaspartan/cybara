import { parseServerSentEvents } from "../agent-internals";
import type { StreamWatchdog } from "./stream-watchdog";

/**
 * Consume an OpenAI-compatible `stream: true` chat completion and assemble it
 * back into the non-streaming response shape the agentic loop already
 * understands. Streaming is what makes inactivity watchdogs possible: a
 * healthy multi-hour generation keeps emitting chunks, while a dead socket
 * goes quiet and trips the stall timer.
 */

interface StreamedToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamedChoiceDelta {
  delta?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: StreamedToolCallDelta[];
  };
  finish_reason?: string | null;
  index?: number;
}

export interface AssembledOpenAIResponse {
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: Record<string, unknown>;
}

export async function consumeOpenAIChatStream(
  body: ReadableStream<Uint8Array>,
  watchdog?: StreamWatchdog,
  onTextDelta?: (delta: string) => void
): Promise<AssembledOpenAIResponse> {
  let content = "";
  let reasoning = "";
  let finishReason = "stop";
  let usage: Record<string, unknown> | undefined;
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  for await (const event of parseServerSentEvents(body)) {
    watchdog?.touch();

    const choices = event.choices as StreamedChoiceDelta[] | undefined;
    if (event.usage && typeof event.usage === "object") {
      usage = event.usage as Record<string, unknown>;
    }
    const choice = choices?.[0];
    if (!choice) continue;

    if (typeof choice.finish_reason === "string" && choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
    const delta = choice.delta;
    if (!delta) continue;

    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      onTextDelta?.(delta.content);
    }
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      reasoning += delta.reasoning_content;
    }
    for (const toolDelta of delta.tool_calls || []) {
      const index = typeof toolDelta.index === "number" ? toolDelta.index : 0;
      const existing = toolCalls.get(index) || { id: "", name: "", args: "" };
      if (typeof toolDelta.id === "string" && toolDelta.id) existing.id = toolDelta.id;
      if (typeof toolDelta.function?.name === "string" && toolDelta.function.name) {
        existing.name = toolDelta.function.name;
      }
      if (typeof toolDelta.function?.arguments === "string") {
        existing.args += toolDelta.function.arguments;
      }
      toolCalls.set(index, existing);
    }
  }

  const assembledToolCalls = [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({
      id: call.id || `call_${index}_${crypto.randomUUID()}`,
      type: "function" as const,
      function: { name: call.name, arguments: call.args },
    }))
    .filter((call) => call.function.name);

  return {
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || (assembledToolCalls.length > 0 ? null : content),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(assembledToolCalls.length > 0 ? { tool_calls: assembledToolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
  };
}
