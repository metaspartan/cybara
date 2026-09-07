import { CONTEXT_CHARS_PER_TOKEN_ESTIMATE } from "../agent-internals";

export const IMAGE_TOKEN_ESTIMATE = 4096;

const IMAGE_CONTENT_BLOCK_TYPES = new Set(["image", "image_url", "input_image"]);

export function isImageContentBlock(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" && IMAGE_CONTENT_BLOCK_TYPES.has(type);
}

export function estimateRequestValueChars(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + estimateRequestValueChars(item), 0);
  }
  if (!value || typeof value !== "object") return 0;
  if (isImageContentBlock(value)) {
    return IMAGE_TOKEN_ESTIMATE * CONTEXT_CHARS_PER_TOKEN_ESTIMATE;
  }
  return Object.entries(value as Record<string, unknown>).reduce(
    (sum, [key, item]) => sum + key.length + estimateRequestValueChars(item),
    0
  );
}

export function estimateOpenAIRequestTokens(requestBody: Record<string, unknown>): number {
  const chars =
    estimateRequestValueChars(requestBody.model) +
    estimateRequestValueChars(requestBody.messages) +
    estimateRequestValueChars(requestBody.tools) +
    estimateRequestValueChars(requestBody.tool_choice);
  return Math.max(1, Math.ceil(chars / CONTEXT_CHARS_PER_TOKEN_ESTIMATE));
}
