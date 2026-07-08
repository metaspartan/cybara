const ROLE_TAG_PATTERN =
  /<\/?(?:tool_call|function_call|result|response|output|input|system|assistant|user)>/gi;
const FENCE_OPEN_PATTERN = /^\s*```(?:json|xml|html|markdown)?\s*/gim;
const FENCE_CLOSE_PATTERN = /\s*```\s*$/gim;
const CDATA_PATTERN = /<!\[CDATA\[.*?\]\]>/gis;
const MAX_TOOL_ERROR_LENGTH = 2000;

export function sanitizeToolErrorMessage(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message || "")
          : String(error || "");
  let sanitized = raw
    .replace(ROLE_TAG_PATTERN, "")
    .replace(FENCE_OPEN_PATTERN, "")
    .replace(FENCE_CLOSE_PATTERN, "")
    .replace(CDATA_PATTERN, "")
    .trim();
  if (!sanitized) sanitized = "Tool execution failed";
  if (sanitized.length > MAX_TOOL_ERROR_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_TOOL_ERROR_LENGTH - 3)}...`;
  }
  return sanitized;
}

export function isToolPolicyBlockedMessage(message: string): boolean {
  const normalized = message.trim();
  return (
    /^refused:/i.test(normalized) ||
    /^validation error:/i.test(normalized) ||
    /^tool '.+' was denied by the operator\./i.test(normalized)
  );
}
