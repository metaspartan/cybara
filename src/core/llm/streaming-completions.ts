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
  first_token_ms?: number;
}

export async function consumeOpenAIChatStream(
  body: ReadableStream<Uint8Array>,
  watchdog?: StreamWatchdog,
  onTextDelta?: (delta: string) => void,
  requestStartedAt?: number
): Promise<AssembledOpenAIResponse> {
  let content = "";
  let reasoning = "";
  let finishReason = "stop";
  let usage: Record<string, unknown> | undefined;
  let firstTokenMs: number | undefined;
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  const markFirstToken = (): void => {
    if (firstTokenMs !== undefined || requestStartedAt === undefined) return;
    firstTokenMs = Math.max(0, Math.round(performance.now() - requestStartedAt));
  };

  for await (const event of parseServerSentEvents(body)) {
    const choices = event.choices as StreamedChoiceDelta[] | undefined;
    let madeProgress = false;
    if (event.usage && typeof event.usage === "object") {
      usage = event.usage as Record<string, unknown>;
      madeProgress = true;
    }
    const choice = choices?.[0];
    if (!choice) {
      if (madeProgress) watchdog?.touch();
      continue;
    }

    if (typeof choice.finish_reason === "string" && choice.finish_reason) {
      finishReason = choice.finish_reason;
      madeProgress = true;
    }
    const delta = choice.delta;
    if (!delta) {
      if (madeProgress) watchdog?.touch();
      continue;
    }

    if (typeof delta.content === "string" && delta.content) {
      markFirstToken();
      content += delta.content;
      onTextDelta?.(delta.content);
      madeProgress = true;
    }
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      markFirstToken();
      reasoning += delta.reasoning_content;
      madeProgress = true;
    }
    for (const toolDelta of delta.tool_calls || []) {
      const hasToolProgress =
        (typeof toolDelta.id === "string" && toolDelta.id.length > 0) ||
        (typeof toolDelta.function?.name === "string" && toolDelta.function.name.length > 0) ||
        (typeof toolDelta.function?.arguments === "string" &&
          toolDelta.function.arguments.length > 0);
      if (!hasToolProgress) continue;
      markFirstToken();
      madeProgress = true;
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
    if (madeProgress) watchdog?.touch();
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
    ...(firstTokenMs !== undefined ? { first_token_ms: firstTokenMs } : {}),
  };
}
