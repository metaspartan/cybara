export interface AnthropicCacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  cache_control?: AnthropicCacheControl;
  [key: string]: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicCacheRequest {
  system?: string | Array<AnthropicContentBlock | string>;
  messages: AnthropicMessage[];
}

export type CacheStrategy = "system_and_last" | "system_and_3" | "disabled";

export interface ApplyCacheOptions {
  strategy?: CacheStrategy;
  ttl?: "5m" | "1h";
  maxBreakpoints?: number;
}

const DEFAULT_MAX_BREAKPOINTS = 4;

function normalizeSystem(
  system: AnthropicCacheRequest["system"]
): Array<AnthropicContentBlock | string> {
  if (system === undefined) return [];
  if (typeof system === "string") {
    return system ? [system] : [];
  }
  return system;
}

function toBlock(part: AnthropicContentBlock | string): AnthropicContentBlock {
  return typeof part === "string" ? { type: "text", text: part } : part;
}

function withoutBreakpoint(block: AnthropicContentBlock): AnthropicContentBlock {
  const { cache_control: _cacheControl, ...rest } = block;
  return rest;
}

function addBreakpoint(block: AnthropicContentBlock, ttl: "5m" | "1h"): AnthropicContentBlock {
  if (block.cache_control) return block;
  return { ...block, cache_control: { type: "ephemeral", ttl } };
}

function ensureBlockForm(message: AnthropicMessage): AnthropicMessage {
  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: [{ type: "text", text: message.content }],
    };
  }
  return {
    role: message.role,
    content: message.content.map(withoutBreakpoint),
  };
}

export function applyAnthropicCacheControl(
  request: AnthropicCacheRequest,
  options: ApplyCacheOptions = {}
): AnthropicCacheRequest {
  const strategy = options.strategy ?? "system_and_3";
  if (strategy === "disabled") return request;
  if (!request.messages || request.messages.length === 0) return request;

  const ttl = options.ttl ?? "1h";
  const maxBreakpoints = options.maxBreakpoints ?? DEFAULT_MAX_BREAKPOINTS;

  let breakpointsUsed = 0;

  const systemParts = normalizeSystem(request.system).map(toBlock).map(withoutBreakpoint);
  if (systemParts.length > 0) {
    const last = systemParts[systemParts.length - 1];
    systemParts[systemParts.length - 1] = addBreakpoint(last, ttl);
    breakpointsUsed += 1;
  }

  const messages = request.messages.map(ensureBlockForm);
  const trailingCount = strategy === "system_and_last" ? 1 : Math.min(3, messages.length);
  const remaining = Math.max(0, maxBreakpoints - breakpointsUsed);
  const toMark = Math.min(trailingCount, remaining);
  if (toMark > 0) {
    for (let i = messages.length - toMark; i < messages.length; i += 1) {
      const blocks = messages[i].content as AnthropicContentBlock[];
      if (blocks.length > 0) {
        const lastBlock = blocks[blocks.length - 1];
        blocks[blocks.length - 1] = addBreakpoint(lastBlock, ttl);
      }
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts : request.system,
    messages,
  };
}
