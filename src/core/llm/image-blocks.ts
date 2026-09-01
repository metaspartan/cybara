export interface AgentImage {
  data?: string;
  url?: string;
  path?: string;
  mimeType?: string;
}

const SUPPORTED_ANTHROPIC_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function normalizeMimeType(mime?: string): string {
  const m = (mime || "").trim().toLowerCase();
  if (m === "image/jpg") return "image/jpeg";
  return m || "image/png";
}

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

interface BedrockImageContentBlock extends Record<string, unknown> {
  image: {
    format: "gif" | "jpeg" | "png" | "webp";
    source: { bytes: Buffer };
  };
}

export function toBedrockImageBlock(image: AgentImage): BedrockImageContentBlock | null {
  const { data, mimeType } = resolveImage(image);
  if (!data) return null;
  const rawFormat = mimeType.replace(/^image\//, "");
  const format = rawFormat === "jpg" ? "jpeg" : rawFormat;
  if (format !== "gif" && format !== "jpeg" && format !== "png" && format !== "webp") return null;
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

export function toGoogleImagePart(image: AgentImage): Record<string, unknown> | null {
  const { data, mimeType } = resolveImage(image);
  if (!data) return null;
  return { inlineData: { mimeType, data } };
}

export function hasImages(images?: AgentImage[]): images is AgentImage[] {
  return Array.isArray(images) && images.some((i) => !!(i.data || i.url));
}

export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INLINE_BASE64_CHARS = Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3) + 4;

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
