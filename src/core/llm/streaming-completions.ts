import { parseServerSentEvents } from "../agent-internals";
import type { StreamWatchdog } from "./stream-watchdog";

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
  generation_duration_ms?: number;
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
  let firstOutputAt: number | undefined;
  let lastOutputAt: number | undefined;
  let outputEventCount = 0;
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  const markOutputProgress = (): void => {
    const now = performance.now();
    if (firstOutputAt === undefined) firstOutputAt = now;
    lastOutputAt = now;
    outputEventCount += 1;
    if (firstTokenMs === undefined && requestStartedAt !== undefined) {
      firstTokenMs = Math.max(0, Math.round(now - requestStartedAt));
    }
  };

  for await (const event of parseServerSentEvents(body)) {
    const choices = event.choices as StreamedChoiceDelta[] | undefined;
    let madeProgress = false;
    let madeOutputProgress = false;
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
      content += delta.content;
      onTextDelta?.(delta.content);
      madeProgress = true;
      madeOutputProgress = true;
    }
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      madeProgress = true;
      madeOutputProgress = true;
    }
    for (const toolDelta of delta.tool_calls || []) {
      const hasToolProgress =
        (typeof toolDelta.id === "string" && toolDelta.id.length > 0) ||
        (typeof toolDelta.function?.name === "string" && toolDelta.function.name.length > 0) ||
        (typeof toolDelta.function?.arguments === "string" &&
          toolDelta.function.arguments.length > 0);
      if (!hasToolProgress) continue;
      madeProgress = true;
      madeOutputProgress = true;
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
    if (madeOutputProgress) markOutputProgress();
    if (madeProgress) watchdog?.touch();
  }

  const generationDurationMs =
    outputEventCount > 1 && firstOutputAt !== undefined && lastOutputAt !== undefined
      ? Math.round(lastOutputAt - firstOutputAt)
      : undefined;

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
    ...(generationDurationMs !== undefined && generationDurationMs > 0
      ? { generation_duration_ms: generationDurationMs }
      : {}),
  };
}
