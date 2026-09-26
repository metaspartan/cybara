import type { AnthropicContentBlock, AnthropicResponse, AnthropicUsage } from "../agent-internals";
import { postAnthropicMessages } from "./anthropic-sdk-transport";

export interface AnthropicStreamTiming {
  firstTokenMs?: number;
  generationDurationMs?: number;
}

export interface AnthropicMessageRead {
  message: AnthropicResponse;
  timing: AnthropicStreamTiming;
}

interface StreamBlock {
  type: string;
  text: string;
  thinking: string;
  signature: string;
  data: string;
  toolId: string;
  toolName: string;
  toolInput: string;
}

interface SseEvent {
  event: string;
  data: string;
}

const STREAM_REJECTION_STATUSES = new Set([400, 404, 415, 422]);
const STREAM_REJECTION_PATTERN = /\bstream(?:ing)?\b/i;

function emptyBlock(type: string): StreamBlock {
  return {
    type,
    text: "",
    thinking: "",
    signature: "",
    data: "",
    toolId: "",
    toolName: "",
    toolInput: "",
  };
}

function parseSseEvents(streamText: string): SseEvent[] {
  const events: SseEvent[] = [];
  let eventName = "";
  let dataLines: string[] = [];
  const flush = () => {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }
    events.push({ event: eventName, data: dataLines.join("\n") });
    eventName = "";
    dataLines = [];
  };
  for (const rawLine of streamText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  flush();
  return events;
}

function recordValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function parseJsonObject(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toContentBlock(block: StreamBlock): AnthropicContentBlock {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "thinking") {
    return block.signature
      ? { type: "thinking", thinking: block.thinking, signature: block.signature }
      : { type: "thinking", thinking: block.thinking };
  }
  if (block.type === "redacted_thinking") {
    return { type: "redacted_thinking", data: block.data };
  }
  return {
    type: "tool_use",
    id: block.toolId,
    name: block.toolName,
    input: parseJsonObject(block.toolInput),
  };
}

function usageFromRecords(
  startUsage: Record<string, unknown> | undefined,
  deltaUsage: Record<string, unknown> | undefined
): AnthropicUsage {
  const merged: Record<string, unknown> = { ...startUsage, ...deltaUsage };
  const numberValue = (key: string): number | undefined => {
    const value = merged[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  return {
    input_tokens: numberValue("input_tokens") ?? 0,
    output_tokens: numberValue("output_tokens") ?? 0,
    ...(numberValue("cache_read_input_tokens") !== undefined
      ? { cache_read_input_tokens: numberValue("cache_read_input_tokens") }
      : {}),
    ...(numberValue("cache_creation_input_tokens") !== undefined
      ? { cache_creation_input_tokens: numberValue("cache_creation_input_tokens") }
      : {}),
  };
}

export function parseAnthropicEventStream(
  streamText: string,
  requestStartedAtMs: number,
  nowMs: () => number = () => performance.now()
): AnthropicMessageRead {
  const blocks = new Map<number, StreamBlock>();
  let messageId = "";
  let model = "";
  let role = "assistant";
  let stopReason: string | null = null;
  let startUsage: Record<string, unknown> | undefined;
  let deltaUsage: Record<string, unknown> | undefined;
  let firstContentAtMs: number | undefined;
  let endedAtMs: number | undefined;
  let sawStreamEnd = false;

  const markContent = () => {
    if (firstContentAtMs === undefined) firstContentAtMs = nowMs();
  };

  for (const event of parseSseEvents(streamText)) {
    if (!event.data.trim()) continue;
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      payload = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const eventType = typeof payload.type === "string" ? payload.type : event.event || "";
    if (eventType === "ping") continue;
    if (eventType === "error") {
      const errorRecord =
        payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
          ? (payload.error as Record<string, unknown>)
          : payload;
      throw new Error(
        `Anthropic stream error: ${recordValue(errorRecord, "message") || "unknown"}`
      );
    }
    if (eventType === "message_start") {
      const message =
        payload.message && typeof payload.message === "object" && !Array.isArray(payload.message)
          ? (payload.message as Record<string, unknown>)
          : payload;
      messageId = recordValue(message, "id") || messageId;
      model = recordValue(message, "model") || model;
      role = recordValue(message, "role") || role;
      const usage =
        message.usage && typeof message.usage === "object" && !Array.isArray(message.usage)
          ? (message.usage as Record<string, unknown>)
          : undefined;
      if (usage) startUsage = { ...startUsage, ...usage };
      continue;
    }
    if (eventType === "content_block_start") {
      const index = typeof payload.index === "number" ? payload.index : blocks.size;
      const rawBlock =
        payload.content_block && typeof payload.content_block === "object"
          ? (payload.content_block as Record<string, unknown>)
          : {};
      const block = emptyBlock(recordValue(rawBlock, "type") || "text");
      block.text = recordValue(rawBlock, "text");
      block.thinking = recordValue(rawBlock, "thinking");
      block.signature = recordValue(rawBlock, "signature");
      block.data = recordValue(rawBlock, "data");
      block.toolId = recordValue(rawBlock, "id");
      block.toolName = recordValue(rawBlock, "name");
      const initialInput = rawBlock.input;
      if (
        initialInput &&
        typeof initialInput === "object" &&
        !Array.isArray(initialInput) &&
        Object.keys(initialInput).length > 0
      ) {
        block.toolInput = JSON.stringify(initialInput);
      }
      blocks.set(index, block);
      if (block.text.trim() || block.thinking.trim() || block.toolInput.trim()) markContent();
      continue;
    }
    if (eventType === "content_block_delta") {
      const index = typeof payload.index === "number" ? payload.index : blocks.size;
      const rawDelta =
        payload.delta && typeof payload.delta === "object" && !Array.isArray(payload.delta)
          ? (payload.delta as Record<string, unknown>)
          : {};
      const block = blocks.get(index) ?? emptyBlock("text");
      const deltaType = recordValue(rawDelta, "type");
      const textDelta = recordValue(rawDelta, "text");
      const thinkingDelta = recordValue(rawDelta, "thinking");
      const partialJson = recordValue(rawDelta, "partial_json");
      if (deltaType === "text_delta" || (!deltaType && textDelta)) {
        block.text += textDelta;
        if (textDelta) markContent();
      } else if (deltaType === "thinking_delta" || (!deltaType && thinkingDelta)) {
        block.thinking += thinkingDelta;
        if (thinkingDelta) markContent();
      } else if (deltaType === "signature_delta") {
        block.signature += recordValue(rawDelta, "signature");
      } else if (deltaType === "input_json_delta") {
        if (block.toolInput === "{}") block.toolInput = "";
        block.toolInput += partialJson;
        if (partialJson) markContent();
      }
      blocks.set(index, block);
      continue;
    }
    if (eventType === "message_delta") {
      const rawDelta =
        payload.delta && typeof payload.delta === "object" && !Array.isArray(payload.delta)
          ? (payload.delta as Record<string, unknown>)
          : {};
      const stop = rawDelta.stop_reason;
      if (typeof stop === "string") stopReason = stop;
      const usage =
        payload.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage)
          ? (payload.usage as Record<string, unknown>)
          : undefined;
      if (usage) deltaUsage = { ...deltaUsage, ...usage };
      continue;
    }
    if (eventType === "message_stop") {
      sawStreamEnd = true;
      endedAtMs = nowMs();
    }
  }

  if (!sawStreamEnd) endedAtMs = nowMs();

  const content = [...blocks.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, block]) => toContentBlock(block));
  const message: AnthropicResponse = {
    id: messageId,
    type: "message",
    role,
    model,
    content,
    usage: usageFromRecords(startUsage, deltaUsage),
  };

  const timing: AnthropicStreamTiming = {};
  if (firstContentAtMs !== undefined) {
    timing.firstTokenMs = Math.max(0, Math.round(firstContentAtMs - requestStartedAtMs));
    const finishedAtMs = endedAtMs ?? nowMs();
    timing.generationDurationMs = Math.max(0, Math.round(finishedAtMs - firstContentAtMs));
  }
  return { message, timing };
}

export function isAnthropicEventStream(response: Response): boolean {
  const contentType = response.headers.get("content-type") || "";
  return contentType.toLowerCase().includes("text/event-stream");
}

const CONTENT_DELTA_PATTERN = /"type"\s*:\s*"(?:text_delta|thinking_delta|input_json_delta)"/;
const STREAM_END_PATTERN = /"message_stop"/;

export async function readAnthropicMessageBody(
  response: Response,
  requestStartedAtMs: number,
  nowMs?: () => number
): Promise<AnthropicMessageRead> {
  if (!isAnthropicEventStream(response)) {
    return {
      message: (await response.json()) as AnthropicResponse,
      timing: {},
    };
  }
  const now = nowMs ?? (() => performance.now());
  const body = response.body;
  if (!body) return parseAnthropicEventStream(await response.text(), requestStartedAtMs, now);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let streamText = "";
  let firstContentAtMs: number | undefined;
  let endedAtMs: number | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    const arrivedAtMs = now();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    streamText += chunk;
    if (firstContentAtMs === undefined && CONTENT_DELTA_PATTERN.test(chunk)) {
      firstContentAtMs = arrivedAtMs;
    }
    if (endedAtMs === undefined && STREAM_END_PATTERN.test(chunk)) {
      endedAtMs = arrivedAtMs;
    }
  }
  streamText += decoder.decode();
  const parsed = parseAnthropicEventStream(streamText, requestStartedAtMs, now);
  const timing: AnthropicStreamTiming = {};
  if (firstContentAtMs !== undefined) {
    timing.firstTokenMs = Math.max(0, Math.round(firstContentAtMs - requestStartedAtMs));
    timing.generationDurationMs = Math.max(0, Math.round((endedAtMs ?? now()) - firstContentAtMs));
  }
  return { message: parsed.message, timing };
}

export function anthropicTimingOptions(
  timing: AnthropicStreamTiming,
  fallbackDurationMs: number
): { firstTokenMs?: number; generationDurationMs: number } {
  const measuredGenerationMs = timing.generationDurationMs;
  return {
    ...(timing.firstTokenMs !== undefined ? { firstTokenMs: timing.firstTokenMs } : {}),
    generationDurationMs:
      measuredGenerationMs !== undefined && measuredGenerationMs >= 100
        ? measuredGenerationMs
        : fallbackDurationMs,
  };
}

function replayResponse(source: Response, bodyText: string): Response {
  return new Response(bodyText, {
    status: source.status,
    statusText: source.statusText,
    headers: source.headers,
  });
}

export async function postAnthropicStreamableMessages(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
  init: { headers: Record<string, string>; signal?: AbortSignal },
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const streamed = await postAnthropicMessages(
    baseUrl,
    endpoint,
    {
      method: "POST",
      headers: init.headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal: init.signal,
    },
    fetchImpl
  );
  if (streamed.ok || !STREAM_REJECTION_STATUSES.has(streamed.status)) return streamed;
  const errorText = await streamed.text();
  if (!STREAM_REJECTION_PATTERN.test(errorText)) {
    return replayResponse(streamed, errorText);
  }
  return await postAnthropicMessages(
    baseUrl,
    endpoint,
    {
      method: "POST",
      headers: init.headers,
      body: JSON.stringify(body),
      signal: init.signal,
    },
    fetchImpl
  );
}
