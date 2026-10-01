import {
  describesMissingToolCallArguments,
  isUpstreamJsonDecodeError,
  serializeToolCallArguments,
} from "./tool-call-argument-repair";

interface WireFunction {
  name?: unknown;
  arguments?: unknown;
}

interface WireToolCall {
  id?: unknown;
  type?: unknown;
  function?: WireFunction;
}

interface WireMessage {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
}

function asMessages(requestBody: Record<string, unknown>): WireMessage[] {
  const messages = requestBody.messages;
  return Array.isArray(messages) ? (messages as WireMessage[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function shouldRetryByRepairingToolCallArguments(
  status: number,
  errorText: string,
  requestBody: Record<string, unknown>
): boolean {
  if (status !== 400 && status !== 422) return false;
  if (!isUpstreamJsonDecodeError(errorText) && !describesMissingToolCallArguments(errorText)) {
    return false;
  }
  return countUnserializableToolCallArguments(requestBody) > 0;
}

export function countUnserializableToolCallArguments(requestBody: Record<string, unknown>): number {
  let broken = 0;
  for (const message of asMessages(requestBody)) {
    if (!isRecord(message) || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls as WireToolCall[]) {
      const fn = isRecord(call) && isRecord(call.function) ? call.function : undefined;
      const raw = fn?.arguments;
      if (typeof raw !== "string") continue;
      try {
        JSON.parse(raw);
      } catch {
        broken += 1;
      }
    }
  }
  return broken;
}

export function toRepairedToolCallArgumentsRequestBody(
  requestBody: Record<string, unknown>
): Record<string, unknown> {
  const nextBody: Record<string, unknown> = { ...requestBody };
  nextBody.messages = asMessages(requestBody).map((message) => {
    if (!isRecord(message) || !Array.isArray(message.tool_calls)) return message;
    let changed = false;
    const toolCalls = (message.tool_calls as WireToolCall[]).map((call) => {
      if (!isRecord(call) || !isRecord(call.function)) return call;
      const fn = call.function;
      const raw = fn.arguments;
      if (typeof raw !== "string") return call;
      try {
        JSON.parse(raw);
        return call;
      } catch {
        changed = true;
        return { ...call, function: { ...fn, arguments: serializeToolCallArguments(raw) } };
      }
    });
    if (!changed) return message;
    return { ...message, tool_calls: toolCalls };
  });
  return nextBody;
}
