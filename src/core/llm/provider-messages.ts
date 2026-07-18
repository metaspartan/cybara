interface ProviderMessagePayload {
  role: string;
  content: unknown;
  images?: unknown[];
  tool_calls?: unknown[];
  tool_call_id?: string;
}

function hasContent(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return content !== null && content !== undefined;
  return content.some((block) => {
    if (typeof block === "string") return block.trim().length > 0;
    if (!block || typeof block !== "object") return false;
    const record = block as Record<string, unknown>;
    return Object.values(record).some((value) =>
      typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined
    );
  });
}

export function hasProviderMessagePayload(message: ProviderMessagePayload): boolean {
  return (
    hasContent(message.content) ||
    (Array.isArray(message.images) && message.images.length > 0) ||
    (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) ||
    (message.role === "tool" && typeof message.tool_call_id === "string")
  );
}

export function normalizeProviderMessages<T extends ProviderMessagePayload>(messages: T[]): T[] {
  return messages.filter(
    (message) => message.role !== "assistant" || hasProviderMessagePayload(message)
  );
}
