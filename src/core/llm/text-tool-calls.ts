export interface TextToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface OpenAICompatToolCall {
  id?: string;
  type?: string;
  name?: string;
  tool_name?: string;
  arguments?: unknown;
  args?: unknown;
  input?: unknown;
  parameters?: unknown;
  function?: {
    name?: string;
    arguments?: unknown;
    args?: unknown;
    input?: unknown;
    parameters?: unknown;
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

const MODEL_SPECIAL_TOKEN_PATTERN = /<[|\uFF5C][^|\uFF5C]*[|\uFF5C]>/g;
const MINIMAX_TEXT_SEGMENT_MARKER_PATTERN = /\]?<\]minimax\[\>\[?/gi;
const MINIMAX_TEXT_SEGMENT_MARKER_QUICK_PATTERN = /\]?<\]minimax\[\>\[?/i;
const TOOL_CALL_CONTAINER_PATTERN =
  /<(function_calls|function_call|tool_calls|tool_call)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const TOOL_CALL_RESULT_BLOCK_PATTERN =
  /<(?:function_response|tool_result)\b[^>]*>[\s\S]*?<\/(?:function_response|tool_result)>/gi;
const FUNCTION_XML_BLOCK_PATTERN = /<function\b([^>]*)>([\s\S]*?)<\/function>/gi;
const FUNCTION_EQUALS_BLOCK_PATTERN =
  /<function=([A-Za-z_][A-Za-z0-9_.:-]{0,119})>([\s\S]*?)<\/function>/gi;
const INVOKE_BLOCK_PATTERN = /<invoke\b([^>]*)>([\s\S]*?)<\/invoke>/gi;
const NAMED_PARAMETER_PATTERN =
  /<(?:parameter|param)\b[^>]*\bname=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/(?:parameter|param)>/gi;
const EQUALS_PARAMETER_PATTERN =
  /<(?:parameter|param)=([A-Za-z_][A-Za-z0-9_.:-]{0,119})>([\s\S]*?)<\/(?:parameter|param)>/gi;
const SIMPLE_XML_FIELD_PATTERN = /<([A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const LEGACY_BRACKET_TOOL_CALL_PATTERN =
  /\[\s*TOOL_CALL\s*\]([\s\S]*?)(?:\[\s*\/\s*TOOL_CALL\s*\]|$)/gi;
const LEGACY_BRACKET_TOOL_RESULT_PATTERN =
  /\[\s*TOOL_RESULT\s*\][\s\S]*?(?:\[\s*\/\s*TOOL_RESULT\s*\]|$)/gi;
const NAMED_TOOL_REQUEST_PATTERN =
  /(?:^|\n)\s*\[([A-Za-z_][A-Za-z0-9_.:-]{0,119})\]\s*\r?\n([\s\S]*?)\[\s*END_TOOL_REQUEST\s*\]/gi;
const LABELED_TOOL_JSON_PATTERN =
  /(?:^|\n)\s*\[\s*tool\s*:\s*([A-Za-z_][A-Za-z0-9_.:-]{0,119})\s*\]\s*([\s\S]*?)(?=\r?\n|$)/gi;
const HARMONY_TOOL_CALL_PATTERN =
  /(?:<[\uFF5C|]channel[\uFF5C|]>)?\s*commentary\s+to=([A-Za-z_][A-Za-z0-9_.:-]{0,119})\s+code(?:<[\uFF5C|]message[\uFF5C|]>)?\s*([\s\S]*?)(?:<[\uFF5C|]call[\uFF5C|]>|$)/gi;
const DSML_TOOL_BLOCK_PATTERN =
  /<[\uFF5C|]DSML[\uFF5C|](?:tool_calls|tool_call|function_calls|tool_use_error)>[\s\S]*?<\/[\uFF5C|]DSML[\uFF5C|](?:tool_calls|tool_call|function_calls|tool_use_error)>/gi;
const TOOL_CALL_TAG_PATTERN =
  /<\/?(?:function_calls?|tool_calls?|tool_result|function_response|function|invoke|parameter|param)\b[^>]*>/gi;
const DANGLING_TOOL_CALL_LINE_PATTERN =
  /<(?:function_call|tool_call)\b[^>]*>\s*(?:[{[]|<invoke\b|["']?(?:name|tool_name|function)["']?\s*[:=])[^\r\n]*(?=\r?\n|$)/gi;
const DIRECT_NAMED_XML_TOOL_PATTERN =
  /^\s*<([A-Za-z_][A-Za-z0-9_.:-]{0,119})\b[^>]*>([\s\S]*?)<\/\1>\s*$/i;
const REPLY_DIRECTIVE_LINE_PATTERN =
  /(?:^|\n)[ \t]*\[\[\s*reply_to(?:\s*:\s*[^\]\r\n]+|_current)\s*\]\][ \t]*(?=\n|$)/gi;
const REPLY_DIRECTIVE_INLINE_PATTERN =
  /(^|\n)[ \t]*\[\[\s*reply_to(?:\s*:\s*[^\]\r\n]+|_current)\s*\]\][ \t]*/gi;

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

function normalizeProviderTextMarkers(value: string): string {
  return value
    .replace(MINIMAX_TEXT_SEGMENT_MARKER_PATTERN, "")
    .replace(MODEL_SPECIAL_TOKEN_PATTERN, "");
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

function parseXmlFields(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  SIMPLE_XML_FIELD_PATTERN.lastIndex = 0;

  for (const fieldMatch of body.matchAll(SIMPLE_XML_FIELD_PATTERN)) {
    const rawKey = fieldMatch[1]?.trim();
    if (!rawKey) continue;
    const key = rawKey.toLowerCase();
    if (
      key === "invoke" ||
      key === "function" ||
      key === "parameter" ||
      key === "param" ||
      key === "parameters" ||
      key === "arguments" ||
      key === "name" ||
      key === "tool_name"
    ) {
      continue;
    }
    args[rawKey] = coerceXmlValue(fieldMatch[2] || "");
  }

  return args;
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
    const rawName = record.tool_name ?? record.name ?? record.tool ?? functionRecord?.name;
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

function parseBareCommandArgs(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeMarkupEntities(raw).trim());
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.command !== "string" || record.command.trim().length === 0) return undefined;
  if ("name" in record || "tool" in record || "tool_name" in record || "function" in record) {
    return undefined;
  }
  return record;
}

function parseFunctionXmlToolCalls(raw: string): TextToolCall[] {
  const calls: TextToolCall[] = [];
  FUNCTION_XML_BLOCK_PATTERN.lastIndex = 0;

  for (const match of raw.matchAll(FUNCTION_XML_BLOCK_PATTERN)) {
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

    Object.assign(args, parseXmlFields(body));
    calls.push({ name, args });
  }

  return calls;
}

function parseFunctionEqualsToolCalls(raw: string): TextToolCall[] {
  const calls: TextToolCall[] = [];
  FUNCTION_EQUALS_BLOCK_PATTERN.lastIndex = 0;

  for (const match of raw.matchAll(FUNCTION_EQUALS_BLOCK_PATTERN)) {
    const name = match[1]?.trim();
    const body = match[2] || "";
    if (!name) continue;

    const args: Record<string, unknown> = {};
    EQUALS_PARAMETER_PATTERN.lastIndex = 0;
    for (const paramMatch of body.matchAll(EQUALS_PARAMETER_PATTERN)) {
      const key = paramMatch[1]?.trim();
      if (!key) continue;
      args[key] = coerceXmlValue(paramMatch[2] || "");
    }

    NAMED_PARAMETER_PATTERN.lastIndex = 0;
    for (const paramMatch of body.matchAll(NAMED_PARAMETER_PATTERN)) {
      const key = paramMatch[2]?.trim();
      if (!key) continue;
      args[key] = coerceXmlValue(paramMatch[3] || "");
    }

    calls.push({ name, args });
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
    Object.assign(args, parseXmlFields(body));

    calls.push({ name, args });
  }

  return calls;
}

function parseDirectNamedXmlToolCall(raw: string, allowedToolNames: Set<string>): TextToolCall[] {
  const match = raw.match(DIRECT_NAMED_XML_TOOL_PATTERN);
  const name = match?.[1]?.trim();
  if (!name || !allowedToolNames.has(name)) return [];
  return [{ name, args: parseXmlFields(match?.[2] || "") }];
}

function findBalancedJsonEnd(text: string, start: number): number | undefined {
  const opening = text[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : undefined;
  if (!closing) return undefined;

  const stack: string[] = [closing];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack.at(-1) !== char) return undefined;
      stack.pop();
      if (stack.length === 0) return index + 1;
    }
  }

  return undefined;
}

function findTrailingJsonToolCallBlock(
  raw: string
): { start: number; end: number; raw: string } | undefined {
  const text = decodeMarkupEntities(raw).trimEnd();
  if (!text) return undefined;

  for (let start = text.length - 1; start >= 0; start--) {
    const char = text[start];
    if (char !== "{" && char !== "[") continue;

    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    if (text.slice(lineStart, start).trim()) continue;

    const end = findBalancedJsonEnd(text, start);
    if (end !== text.length) continue;

    const block = text.slice(start, end);
    if (parseJsonToolCalls(block).length === 0) continue;

    return { start, end, raw: block };
  }

  return undefined;
}

function findLeadingBareCommandJsonBlock(
  raw: string
): { start: number; end: number; raw: string; args: Record<string, unknown> } | undefined {
  const text = decodeMarkupEntities(raw);
  const start = text.match(/^\s*/)?.[0].length || 0;
  if (text[start] !== "{") return undefined;

  const end = findBalancedJsonEnd(text, start);
  if (end === undefined) return undefined;

  const block = text.slice(start, end);
  const args = parseBareCommandArgs(block);
  return args ? { start, end, raw: block, args } : undefined;
}

function parseJsonishAfterLabel(payload: string, label: string): unknown {
  const match = new RegExp(`\\b${label}\\s*=>\\s*`, "i").exec(payload);
  if (!match) return undefined;
  let cursor = (match.index || 0) + match[0].length;
  while (cursor < payload.length && /\s/.test(payload[cursor])) cursor++;
  const startChar = payload[cursor];
  if (startChar === "{" || startChar === "[") {
    const end = findBalancedJsonEnd(payload, cursor);
    if (end !== undefined) return payload.slice(cursor, end);
  }
  if (startChar === '"' || startChar === "'") {
    const quote = startChar;
    let escaped = false;
    for (let index = cursor + 1; index < payload.length; index++) {
      const char = payload[index];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        return payload.slice(cursor + 1, index);
      }
    }
  }
  const end = payload.slice(cursor).search(/(?:,\s*\w+\s*=>|\r?\n|$)/);
  return payload.slice(cursor, end < 0 ? payload.length : cursor + end).trim();
}

function parseLegacyBracketToolCalls(raw: string): TextToolCall[] {
  const calls: TextToolCall[] = [];
  LEGACY_BRACKET_TOOL_CALL_PATTERN.lastIndex = 0;

  for (const match of raw.matchAll(LEGACY_BRACKET_TOOL_CALL_PATTERN)) {
    const payload = match[1] || "";
    calls.push(...parseJsonToolCalls(payload));

    const toolName =
      /\btool\s*=>\s*["']([A-Za-z_][A-Za-z0-9_.:-]{0,119})["']/i.exec(payload)?.[1] ||
      /\bname\s*=>\s*["']([A-Za-z_][A-Za-z0-9_.:-]{0,119})["']/i.exec(payload)?.[1];
    if (!toolName) continue;

    const argsPayload = parseJsonishAfterLabel(payload, "args");
    calls.push({ name: toolName, args: parseArgs(argsPayload) });
  }

  return calls;
}

function parsePlainTextToolCalls(raw: string): TextToolCall[] {
  const calls: TextToolCall[] = [];

  NAMED_TOOL_REQUEST_PATTERN.lastIndex = 0;
  for (const match of raw.matchAll(NAMED_TOOL_REQUEST_PATTERN)) {
    const name = match[1]?.trim();
    if (!name) continue;
    calls.push({ name, args: parseArgs(match[2]?.trim() || "") });
  }

  LABELED_TOOL_JSON_PATTERN.lastIndex = 0;
  for (const match of raw.matchAll(LABELED_TOOL_JSON_PATTERN)) {
    const name = match[1]?.trim();
    if (!name) continue;
    calls.push({ name, args: parseArgs(match[2]?.trim() || "") });
  }

  HARMONY_TOOL_CALL_PATTERN.lastIndex = 0;
  for (const match of raw.matchAll(HARMONY_TOOL_CALL_PATTERN)) {
    const name = match[1]?.trim();
    if (!name) continue;
    calls.push({ name, args: parseArgs(match[2]?.trim() || "") });
  }

  return calls;
}

function parseTrailingJsonToolCalls(raw: string): TextToolCall[] {
  const block = findTrailingJsonToolCallBlock(raw);
  return block ? parseJsonToolCalls(block.raw) : [];
}

function parseBareCommandJsonToolCalls(raw: string): TextToolCall[] {
  const block = findLeadingBareCommandJsonBlock(raw);
  if (!block) return [];
  if (raw.slice(0, block.start).trim() || raw.slice(block.end).trim()) return [];
  return [{ name: "exec", args: block.args }];
}

function parseWrappedToolCallContainers(raw: string, depth = 0): TextToolCall[] {
  if (depth > 2) return [];
  const calls: TextToolCall[] = [];
  const containerPattern = new RegExp(TOOL_CALL_CONTAINER_PATTERN.source, "gi");

  for (const match of raw.matchAll(containerPattern)) {
    const body = match[2] || "";
    calls.push(
      ...parseJsonToolCalls(body),
      ...parseXmlInvokeToolCalls(body),
      ...parseFunctionXmlToolCalls(body),
      ...parseFunctionEqualsToolCalls(body),
      ...parseWrappedToolCallContainers(body, depth + 1)
    );
  }

  return calls;
}

function resolveAllowedToolName(
  rawName: string,
  allowedToolNames: Set<string>
): string | undefined {
  const trimmed = rawName.trim();
  if (!trimmed) return undefined;
  if (allowedToolNames.size === 0) return undefined;
  if (allowedToolNames.has(trimmed)) return trimmed;
  return undefined;
}

function filterAllowedToolCalls(
  calls: TextToolCall[],
  allowedToolNames: Set<string>
): TextToolCall[] {
  const filtered: TextToolCall[] = [];
  const seen = new Set<string>();

  for (const call of calls) {
    const name = resolveAllowedToolName(call.name, allowedToolNames);
    if (!name) continue;
    const args = call.args || {};
    const key = `${name}:${JSON.stringify(args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push({ name, args });
  }

  return filtered;
}

export function extractTextToolCalls(
  content: string | null | undefined,
  allowedToolNames: Set<string> = new Set()
): TextToolCall[] {
  if (!content) return [];
  const normalizedContent = normalizeProviderTextMarkers(content);
  const calls: TextToolCall[] = [];
  calls.push(
    ...parseWrappedToolCallContainers(normalizedContent),
    ...parseXmlInvokeToolCalls(normalizedContent),
    ...parseFunctionXmlToolCalls(normalizedContent),
    ...parseFunctionEqualsToolCalls(normalizedContent),
    ...parseLegacyBracketToolCalls(normalizedContent),
    ...parsePlainTextToolCalls(normalizedContent),
    ...parseBareCommandJsonToolCalls(normalizedContent),
    ...parseTrailingJsonToolCalls(normalizedContent),
    ...parseDirectNamedXmlToolCall(normalizedContent, allowedToolNames)
  );

  return filterAllowedToolCalls(calls, allowedToolNames);
}

function stripTrailingJsonToolCallMarkup(content: string): string {
  const block = findTrailingJsonToolCallBlock(content);
  return block ? content.slice(0, block.start).trimEnd() : content;
}

function stripLeadingBareCommandJsonMarkup(content: string): string {
  const block = findLeadingBareCommandJsonBlock(content);
  return block
    ? `${content.slice(0, block.start)}${content.slice(block.end).trimStart()}`
    : content;
}

export function stripTextToolCallMarkup(content: string): string {
  const normalized = normalizeProviderTextMarkers(content);
  if (DIRECT_NAMED_XML_TOOL_PATTERN.test(normalized)) return "";
  const stripped = stripLeadingBareCommandJsonMarkup(normalized)
    .replace(DSML_TOOL_BLOCK_PATTERN, "")
    .replace(TOOL_CALL_RESULT_BLOCK_PATTERN, "")
    .replace(TOOL_CALL_CONTAINER_PATTERN, "")
    .replace(LEGACY_BRACKET_TOOL_CALL_PATTERN, "")
    .replace(LEGACY_BRACKET_TOOL_RESULT_PATTERN, "")
    .replace(FUNCTION_EQUALS_BLOCK_PATTERN, "")
    .replace(FUNCTION_XML_BLOCK_PATTERN, "")
    .replace(INVOKE_BLOCK_PATTERN, "")
    .replace(NAMED_TOOL_REQUEST_PATTERN, "")
    .replace(LABELED_TOOL_JSON_PATTERN, "")
    .replace(HARMONY_TOOL_CALL_PATTERN, "")
    .replace(DANGLING_TOOL_CALL_LINE_PATTERN, "")
    .replace(TOOL_CALL_TAG_PATTERN, "");

  return stripTrailingJsonToolCallMarkup(stripped)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasTextToolCallMarkup(content: string | null | undefined): boolean {
  if (!content) return false;
  return (
    /<function_calls\b/i.test(content) ||
    /<function_call\b/i.test(content) ||
    /<tool_calls\b/i.test(content) ||
    /<tool_call\b/i.test(content) ||
    /<invoke\b/i.test(content) ||
    DIRECT_NAMED_XML_TOOL_PATTERN.test(normalizeProviderTextMarkers(content)) ||
    /\[\s*TOOL_CALL\s*\]/i.test(content) ||
    /<[\uFF5C|]DSML[\uFF5C|](?:tool_calls|tool_call|function_calls)/i.test(content) ||
    MINIMAX_TEXT_SEGMENT_MARKER_QUICK_PATTERN.test(content) ||
    findLeadingBareCommandJsonBlock(normalizeProviderTextMarkers(content)) !== undefined ||
    findTrailingJsonToolCallBlock(normalizeProviderTextMarkers(content)) !== undefined
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

function getOpenAICompatToolCallName(toolCall: OpenAICompatToolCall): string {
  const rawName = toolCall.function?.name ?? toolCall.name ?? toolCall.tool_name;
  return typeof rawName === "string" ? rawName : "";
}

function getOpenAICompatToolCallArgs(toolCall: OpenAICompatToolCall): Record<string, unknown> {
  return parseArgs(
    toolCall.function?.arguments ??
      toolCall.function?.args ??
      toolCall.function?.input ??
      toolCall.function?.parameters ??
      toolCall.arguments ??
      toolCall.args ??
      toolCall.input ??
      toolCall.parameters
  );
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
      name: getOpenAICompatToolCallName(toolCall),
      args: getOpenAICompatToolCallArgs(toolCall),
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
  return stripTextToolCallMarkup(content)
    .replace(REPLY_DIRECTIVE_LINE_PATTERN, "")
    .replace(REPLY_DIRECTIVE_INLINE_PATTERN, "$1")
    .trim();
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
