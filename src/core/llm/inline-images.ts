export const DEFAULT_MAX_INLINE_IMAGES = 8;

const OMITTED_INLINE_IMAGE_TEXT =
  "[earlier image omitted to stay within the provider's per-request image limit]";

const INLINE_IMAGE_BLOCK_TYPES = new Set(["image_url", "input_image", "image"]);

function isInlineImageBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") return false;
  const type = (block as Record<string, unknown>).type;
  return typeof type === "string" && INLINE_IMAGE_BLOCK_TYPES.has(type);
}

export function countInlineImages(messages: Array<Record<string, unknown>>): number {
  let count = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) if (isInlineImageBlock(block)) count += 1;
  }
  return count;
}

export function limitInlineImages(
  messages: Array<Record<string, unknown>>,
  maxImages: number
): number {
  const cap = Math.max(0, Math.floor(maxImages));
  let kept = 0;
  let elided = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!Array.isArray(message.content)) continue;
    let changed = false;
    const nextContent: unknown[] = [];
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.content[blockIndex];
      if (!isInlineImageBlock(block)) {
        nextContent.unshift(block);
        continue;
      }
      if (kept < cap) {
        kept += 1;
        nextContent.unshift(block);
        continue;
      }
      elided += 1;
      changed = true;
      const textType =
        (block as Record<string, unknown>).type === "input_image" ? "input_text" : "text";
      nextContent.unshift({ type: textType, text: OMITTED_INLINE_IMAGE_TEXT });
    }
    if (changed) message.content = nextContent;
  }
  return elided;
}

export function parseProviderInlineImageLimit(errorText: string): number | undefined {
  const match = errorText.match(/at most\s+(\d+)\s+image/i);
  if (!match) return undefined;
  const limit = Number.parseInt(match[1] || "", 10);
  return Number.isFinite(limit) && limit >= 0 ? limit : undefined;
}
