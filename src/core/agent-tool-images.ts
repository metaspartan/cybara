import { extname } from "node:path";
import {
  COMPUTER_USE_ACTION_TOOL_ALIASES,
  COMPUTER_USE_COMPAT_TOOL_ALIASES,
} from "./computer-use-actions";
import type { AgentToolCallResult } from "./agent-internals";
import { type AgentImage, MAX_INLINE_IMAGE_BYTES, toOpenAIImageBlock } from "./llm/image-blocks";
import { prepareAgentImageForProvider } from "./llm/provider-image-input";

const imageMediaTypes = new Map([
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const visualToolNames = new Set([
  "image",
  "browser",
  "browser_screenshot",
  "computer_use",
  "mobile_simulator",
  "read",
  ...COMPUTER_USE_ACTION_TOOL_ALIASES,
  ...Object.keys(COMPUTER_USE_COMPAT_TOOL_ALIASES),
]);

function imagePathFromToolCall(toolCall: AgentToolCallResult): string | undefined {
  if (!visualToolNames.has(toolCall.name)) return undefined;
  if (!toolCall.result || typeof toolCall.result !== "object") return undefined;
  const result = toolCall.result as Record<string, unknown>;
  const path =
    toolCall.name === "image"
      ? result.image
      : toolCall.name === "read"
        ? result.path
        : result.filePath;
  return typeof path === "string" && path.trim() ? path : undefined;
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
    const prepared = await prepareAgentImageForProvider({ data, mimeType });
    if (prepared) images.push(prepared);
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
      { type: "text", text: "Inspect the image returned by the file or image tool." },
      ...images.map(toOpenAIImageBlock),
    ],
  };
}
