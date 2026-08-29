import { extname } from "node:path";
import type { AgentToolCallResult } from "./agent-internals";
import { type AgentImage, MAX_INLINE_IMAGE_BYTES, toOpenAIImageBlock } from "./llm/image-blocks";

const imageMediaTypes = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function imagePathFromToolCall(toolCall: AgentToolCallResult): string | undefined {
  if (toolCall.name !== "image") return undefined;
  if (!toolCall.result || typeof toolCall.result !== "object") return undefined;
  const image = (toolCall.result as Record<string, unknown>).image;
  return typeof image === "string" && image.trim() ? image : undefined;
}

export async function loadToolResultImages(
  toolCalls: AgentToolCallResult[]
): Promise<AgentImage[]> {
  const images: AgentImage[] = [];
  for (const toolCall of toolCalls) {
    const path = imagePathFromToolCall(toolCall);
    if (!path) continue;
    const mimeType = imageMediaTypes.get(extname(path).toLowerCase());
    if (!mimeType) continue;
    const file = Bun.file(path);
    if (!(await file.exists()) || file.size <= 0 || file.size > MAX_INLINE_IMAGE_BYTES) continue;
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    images.push({ data, mimeType });
  }
  return images;
}

export async function openAIImageToolFollowup(
  toolCalls: AgentToolCallResult[]
): Promise<Record<string, unknown> | undefined> {
  const images = await loadToolResultImages(toolCalls);
  if (images.length === 0) return undefined;
  return {
    role: "user",
    content: [
      { type: "text", text: "Inspect the image returned by the image tool." },
      ...images.map(toOpenAIImageBlock),
    ],
  };
}

export function supportsOpenAICompatibleImageToolFollowup(model: string): boolean {
  return /(?:^|\/)minimax-m3(?:$|[-:])/.test(model.trim().toLowerCase());
}
