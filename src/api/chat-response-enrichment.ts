import { createLogger } from "../core/logger";
import { handleMemorySave } from "../core/tools/handlers/memory";
import type { ToolCallInfo } from "./chat-process-activities";

const log = createLogger("Chat");
const imageExtension = /\.(png|jpe?g|gif|webp)$/i;
const memoryPatterns = [
  /(?:remember|save to memory|store this|note this|don't forget)(?: that |: )?(.+)/i,
  /(?:I'll|I will|I've) (?:already )?(?:saved|stored|remembered|noted)(?: that |: )?(.+)/i,
  /(?:I'll|I will|I've) (?:already )?(?:saved|stored|remembered|noted|keep that in mind|noted it)(?: that |: | for )?(.+)/i,
];

export function appendToolImageReferences(content: string, toolCalls: ToolCallInfo[]): string {
  const imagePaths = toolCalls
    .map((toolCall) => (toolCall.result as { filePath?: unknown } | undefined)?.filePath)
    .filter((path): path is string => typeof path === "string" && imageExtension.test(path));
  let enriched = content;
  for (const imagePath of new Set(imagePaths)) {
    if (!enriched.includes(imagePath)) enriched += `\n\n![screenshot](file://${imagePath})`;
  }
  return enriched;
}

export function extractAutomaticMemoryContent(message: string): string | null {
  for (const pattern of memoryPatterns) {
    const match = message.match(pattern);
    const content = match?.[1]?.trim() || "";
    if (content.length > 3 && content.length < 500) return content;
  }
  return null;
}

export async function maybeSaveAutomaticMemory(input: {
  message: string;
  providerType?: string;
  sessionId: string;
  toolCallCount: number;
}): Promise<boolean> {
  if (input.toolCallCount > 0 || input.providerType !== "minimax") return false;
  const content = extractAutomaticMemoryContent(input.message);
  if (!content) return false;
  try {
    await handleMemorySave({ content, type: "context", tags: ["auto-saved"] });
    log.info("Auto-saved memory", {
      sessionId: input.sessionId,
      preview: content.substring(0, 50),
    });
    return true;
  } catch {
    return false;
  }
}
