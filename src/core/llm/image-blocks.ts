/**
 * Provider-agnostic image input → per-provider content block conversion.
 *
 * Cybara's request builders previously sent text only, so models advertising
 * image input could never actually see an image. These pure helpers turn a
 * normalized AgentImage into the block shape each provider's API expects:
 *   - Anthropic Messages:    { type: "image", source: {...} }
 *   - OpenAI chat/completions:{ type: "image_url", image_url: { url } }
 *   - Google generative-ai:   { inlineData: { mimeType, data } }
 *
 * Kept pure for unit testing.
 */

export interface AgentImage {
  /** Base64 data WITHOUT the data: URI prefix. */
  data?: string;
  /** Remote URL (used when data is absent). */
  url?: string;
  /** Persisted attachment path relative to the cybara home (display/rehydration). */
  path?: string;
  /** MIME type, e.g. "image/png". Defaults to image/png when omitted. */
  mimeType?: string;
}

const SUPPORTED_ANTHROPIC_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function normalizeMimeType(mime?: string): string {
  const m = (mime || "").trim().toLowerCase();
  if (m === "image/jpg") return "image/jpeg";
  return m || "image/png";
}

/** Strip a `data:<mime>;base64,` prefix if present, returning {data, mimeType}. */
export function parseDataUri(value: string): { data: string; mimeType?: string } {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(value.trim());
  if (match) {
    return { data: match[2], mimeType: match[1] };
  }
  return { data: value };
}

function resolveImage(image: AgentImage): { data?: string; url?: string; mimeType: string } {
  let data = image.data;
  let mimeType = image.mimeType;
  // Accept a data: URI passed in either field and split it.
  if (!data && image.url && image.url.startsWith("data:")) {
    const parsed = parseDataUri(image.url);
    data = parsed.data;
    mimeType = mimeType || parsed.mimeType;
  } else if (data && data.startsWith("data:")) {
    const parsed = parseDataUri(data);
    data = parsed.data;
    mimeType = mimeType || parsed.mimeType;
  }
  return { data, url: data ? undefined : image.url, mimeType: normalizeMimeType(mimeType) };
}

export function toAnthropicImageBlock(image: AgentImage): Record<string, unknown> {
  const { data, url, mimeType } = resolveImage(image);
  if (data) {
    const media_type = SUPPORTED_ANTHROPIC_MIME.has(mimeType) ? mimeType : "image/png";
    return { type: "image", source: { type: "base64", media_type, data } };
  }
  // Anthropic supports URL sources on recent API versions.
  return { type: "image", source: { type: "url", url } };
}

export function toOpenAIImageBlock(image: AgentImage): Record<string, unknown> {
  const { data, url, mimeType } = resolveImage(image);
  const finalUrl = data ? `data:${mimeType};base64,${data}` : url;
  return { type: "image_url", image_url: { url: finalUrl } };
}

export function toOpenAIResponsesImageBlock(image: AgentImage): Record<string, unknown> {
  const { data, url, mimeType } = resolveImage(image);
  const finalUrl = data ? `data:${mimeType};base64,${data}` : url;
  return { type: "input_image", image_url: finalUrl };
}

export function toBedrockImageBlock(image: AgentImage): Record<string, unknown> | null {
  const { data, mimeType } = resolveImage(image);
  if (!data) return null;
  const format =
    mimeType.replace(/^image\//, "") === "jpg" ? "jpeg" : mimeType.replace(/^image\//, "");
  return { image: { format, source: { bytes: Buffer.from(data, "base64") } } };
}

export function openAIResponsesUserContent(
  text: string,
  images?: AgentImage[]
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text }];
  if (hasImages(images)) {
    for (const image of images) content.push(toOpenAIResponsesImageBlock(image));
  }
  return content;
}

export function bedrockUserContent(
  text: string,
  images?: AgentImage[]
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ text }];
  if (hasImages(images)) {
    for (const image of images) {
      const block = toBedrockImageBlock(image);
      if (block) content.push(block);
    }
  }
  return content;
}

/** Returns null when the image has only a remote URL (Google needs inline bytes). */
export function toGoogleImagePart(image: AgentImage): Record<string, unknown> | null {
  const { data, mimeType } = resolveImage(image);
  if (!data) return null;
  return { inlineData: { mimeType, data } };
}

/** True when a message has at least one usable image. */
export function hasImages(images?: AgentImage[]): images is AgentImage[] {
  return Array.isArray(images) && images.some((i) => !!(i.data || i.url));
}

export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INLINE_BASE64_CHARS = Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3) + 4;

/**
 * Validate/limit untrusted image inputs from the API: cap count, drop oversized
 * inline payloads, and only allow http(s)/data: URLs (no file:// etc.).
 */
export function sanitizeAgentImages(input: unknown, maxCount = 8): AgentImage[] {
  if (!Array.isArray(input)) return [];
  const out: AgentImage[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const data = typeof r.data === "string" ? r.data : undefined;
    const url = typeof r.url === "string" ? r.url : undefined;
    const mimeType = typeof r.mimeType === "string" ? r.mimeType : undefined;
    if (!data && !url) continue;
    if (data && data.length > MAX_INLINE_BASE64_CHARS) continue;
    if (url && !/^https?:\/\//i.test(url) && !url.startsWith("data:")) continue;
    out.push({ data, url, mimeType });
    if (out.length >= maxCount) break;
  }
  return out;
}
