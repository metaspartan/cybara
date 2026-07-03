export interface TextToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface OpenAICompatToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

export interface OpenAICompatMessage {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAICompatToolCall[];
  [key: string]: unknown;
}

export interface NormalizedOpenAIToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  source: "native" | "text";
}

export interface AnthropicCompatContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface NormalizedAnthropicToolUse {
  id: string;
  name: string;
  args: Record<string, unknown>;
  source: "native" | "text";
}

const FUNCTION_CALLS_BLOCK_PATTERN = /<function_calls\b[^>]*>([\s\S]*?)<\/function_calls>/gi;
const TOOL_CALL_BLOCK_PATTERN = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
const INVOKE_BLOCK_PATTERN = /<invoke\b([^>]*)>([\s\S]*?)<\/invoke>/gi;
const NAMED_PARAMETER_PATTERN =
  /<(?:parameter|param)\b[^>]*\bname=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/(?:parameter|param)>/gi;
const SIMPLE_XML_FIELD_PATTERN = /<([A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function decodeMarkupEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function coerceXmlValue(value: string): unknown {
  const trimmed = decodeMarkupEntities(value).trim();
  if (!trimmed) return "";
  if (/^(?:true|false|null)$/i.test(trimmed)) {
    return JSON.parse(trimmed.toLowerCase()) as unknown;
  }
  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function getXmlField(body: string, field: string): string | undefined {
  const pattern = new RegExp(`<${field}\\b[^>]*>([\\s\\S]*?)<\\/${field}>`, "i");
  const match = body.match(pattern);
  return match?.[1] ? decodeMarkupEntities(match[1]).trim() : undefined;
}

function getInvokeName(attrs: string, body: string): string | undefined {
  const attrMatch = attrs.match(/\bname=(["'])([^"']+)\1/i);
  const fromAttribute = attrMatch?.[2]?.trim();
  if (fromAttribute) return decodeMarkupEntities(fromAttribute);
  return getXmlField(body, "tool_name") || getXmlField(body, "name");
}

function parseJsonToolCalls(raw: string): TextToolCall[] {
  const trimmed = decodeMarkupEntities(raw).trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const calls: TextToolCall[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const functionRecord =
      record.function && typeof record.function === "object" && !Array.isArray(record.function)
        ? (record.function as Record<string, unknown>)
        : undefined;
    const rawName = record.tool_name ?? record.name ?? functionRecord?.name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) continue;

    const args =
      record.arguments ??
      record.args ??
      record.parameters ??
      record.input ??
      functionRecord?.arguments;
    calls.push({ name, args: parseArgs(args) });
  }

  return calls;
}

function parseXmlInvokeToolCalls(raw: string): TextToolCall[] {
  const calls: TextToolCall[] = [];
  INVOKE_BLOCK_PATTERN.lastIndex = 0;

  for (const match of raw.matchAll(INVOKE_BLOCK_PATTERN)) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const name = getInvokeName(attrs, body);
    if (!name) continue;

    const args: Record<string, unknown> = {};
    NAMED_PARAMETER_PATTERN.lastIndex = 0;
    for (const paramMatch of body.matchAll(NAMED_PARAMETER_PATTERN)) {
      const key = paramMatch[2]?.trim();
      if (!key) continue;
      args[key] = coerceXmlValue(paramMatch[3] || "");
    }

    const parametersBody = getXmlField(body, "parameters");
    if (parametersBody) {
      SIMPLE_XML_FIELD_PATTERN.lastIndex = 0;
      for (const fieldMatch of parametersBody.matchAll(SIMPLE_XML_FIELD_PATTERN)) {
        const key = fieldMatch[1]?.trim();
        if (!key || key === "parameter" || key === "param") continue;
        args[key] = coerceXmlValue(fieldMatch[2] || "");
      }
    }

    calls.push({ name, args });
  }

  return calls;
}

function filterAllowedToolCalls(
  calls: TextToolCall[],
  allowedToolNames: Set<string>
): TextToolCall[] {
  return calls.filter((call) => {
    const normalized = call.name.trim();
    if (!normalized) return false;
    if (allowedToolNames.size === 0) return true;
    return allowedToolNames.has(normalized);
  });
}

export function extractTextToolCalls(
  content: string | null | undefined,
  allowedToolNames: Set<string> = new Set()
): TextToolCall[] {
  if (!content) return [];
  const calls: TextToolCall[] = [];

  FUNCTION_CALLS_BLOCK_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(FUNCTION_CALLS_BLOCK_PATTERN)) {
    const body = match[1] || "";
    calls.push(...parseJsonToolCalls(body), ...parseXmlInvokeToolCalls(body));
  }

  TOOL_CALL_BLOCK_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(TOOL_CALL_BLOCK_PATTERN)) {
    calls.push(...parseJsonToolCalls(match[1] || ""));
  }

  if (calls.length === 0) {
    calls.push(...parseXmlInvokeToolCalls(content));
  }

  return filterAllowedToolCalls(calls, allowedToolNames);
}

export function stripTextToolCallMarkup(content: string): string {
  return content
    .replace(FUNCTION_CALLS_BLOCK_PATTERN, "")
    .replace(TOOL_CALL_BLOCK_PATTERN, "")
    .replace(INVOKE_BLOCK_PATTERN, "")
    .replace(/<\/?function_calls\b[^>]*>/gi, "")
    .replace(/<\/?tool_call\b[^>]*>/gi, "")
    .trim();
}

export function hasTextToolCallMarkup(content: string | null | undefined): boolean {
  if (!content) return false;
  return (
    /<function_calls\b/i.test(content) ||
    /<tool_call\b/i.test(content) ||
    /<invoke\b/i.test(content)
  );
}

function toOpenAIReplayAssistantMessage(message: OpenAICompatMessage): Record<string, unknown> {
  const replayMessage: Record<string, unknown> = {
    role: typeof message.role === "string" && message.role.trim() ? message.role : "assistant",
    content: typeof message.content === "string" ? message.content : "",
  };

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    replayMessage.tool_calls = message.tool_calls;
  }

  for (const [key, value] of Object.entries(message)) {
    if (key === "role" || key === "content" || key === "tool_calls") continue;
    if (value !== undefined) {
      replayMessage[key] = value;
    }
  }

  return replayMessage;
}

function toOpenAISyntheticToolCall(call: NormalizedOpenAIToolCall): Record<string, unknown> {
  return {
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.args || {}),
    },
  };
}

export function normalizeOpenAIToolCalls(
  message: OpenAICompatMessage,
  iteration: number,
  allowedToolNames: Set<string>
): NormalizedOpenAIToolCall[] {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return message.tool_calls.map((toolCall, index) => ({
      id:
        typeof toolCall.id === "string" && toolCall.id.trim().length > 0
          ? toolCall.id
          : `cybara-tool-${iteration}-${index + 1}`,
      name: typeof toolCall.function?.name === "string" ? toolCall.function.name : "",
      args: parseArgs(toolCall.function?.arguments),
      source: "native" as const,
    }));
  }

  const textCalls = extractTextToolCalls(message.content || "", allowedToolNames);
  return textCalls.map((toolCall, index) => ({
    id: `cybara-text-tool-${iteration}-${index + 1}`,
    name: toolCall.name,
    args: toolCall.args,
    source: "text" as const,
  }));
}

export function toOpenAIReplayMessageWithNormalizedToolCalls(
  message: OpenAICompatMessage,
  toolCalls: NormalizedOpenAIToolCall[]
): Record<string, unknown> {
  if (toolCalls.every((toolCall) => toolCall.source === "native")) {
    return toOpenAIReplayAssistantMessage(message);
  }

  return {
    role: "assistant",
    content: stripTextToolCallMarkup(typeof message.content === "string" ? message.content : ""),
    tool_calls: toolCalls.map(toOpenAISyntheticToolCall),
  };
}

export function normalizeAnthropicToolUses(
  content: AnthropicCompatContentBlock[] | undefined,
  iteration: number,
  allowedToolNames: Set<string>
): NormalizedAnthropicToolUse[] {
  const blocks = Array.isArray(content) ? content : [];
  const nativeToolUses = blocks.filter((block) => block.type === "tool_use") as Array<{
    type: "tool_use";
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;

  if (nativeToolUses.length > 0) {
    return nativeToolUses.map((toolUse, index) => ({
      id:
        typeof toolUse.id === "string" && toolUse.id.trim().length > 0
          ? toolUse.id
          : `cybara-tool-${iteration}-${index + 1}`,
      name: typeof toolUse.name === "string" ? toolUse.name : "",
      args: toolUse.input || {},
      source: "native" as const,
    }));
  }

  const text = blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n\n");
  const textCalls = extractTextToolCalls(text, allowedToolNames);
  return textCalls.map((toolCall, index) => ({
    id: `cybara-text-tool-${iteration}-${index + 1}`,
    name: toolCall.name,
    args: toolCall.args,
    source: "text" as const,
  }));
}

function copyRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value as Record<string, unknown>));
}

export function toAnthropicReplayContentWithNormalizedToolUses(
  content: AnthropicCompatContentBlock[] | undefined,
  toolUses: NormalizedAnthropicToolUse[],
  toolResultIds: Set<string>
): Array<Record<string, unknown>> {
  const blocks = Array.isArray(content) ? content : [];
  if (toolUses.every((toolUse) => toolUse.source === "native")) {
    return blocks
      .filter(
        (block) =>
          block.type !== "tool_use" || (typeof block.id === "string" && toolResultIds.has(block.id))
      )
      .map(copyRecord);
  }

  const replayBlocks: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      const cleaned = stripTextToolCallMarkup(block.text);
      if (cleaned.trim()) {
        replayBlocks.push({ type: "text", text: cleaned });
      }
      continue;
    }
    if (block.type === "tool_use") continue;
    replayBlocks.push(copyRecord(block));
  }

  for (const toolUse of toolUses) {
    replayBlocks.push({
      type: "tool_use",
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.args || {},
    });
  }

  return replayBlocks;
}

export function sanitizeAssistantContent(content: string): string {
  return stripTextToolCallMarkup(content).trim();
}

export function shouldUseMiniMaxReasoningSplit(
  providerConfig: string | undefined,
  modelId: string
): boolean {
  const normalizedProvider = (providerConfig || "").trim().toLowerCase();
  const normalizedModel = modelId.trim().toLowerCase();
  return (
    normalizedModel === "minimax-m3" ||
    normalizedModel.endsWith("/minimax-m3") ||
    ((normalizedProvider === "minimax" || normalizedProvider === "minimax-portal") &&
      normalizedModel.includes("m3"))
  );
}
