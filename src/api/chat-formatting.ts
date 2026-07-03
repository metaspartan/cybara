import { stripTextToolCallMarkup } from "../core/llm/text-tool-calls";

export interface StripThinkingTagsResult {
  content: string;
  thinking: string;
}

const THINKING_BLOCK_PATTERNS = [
  /<thinking\b[^>]*>([\s\S]*?)<\/thinking>/gi,
  /<think\b[^>]*>([\s\S]*?)<\/think>/gi,
  /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
];

const FINAL_BLOCK_PATTERN = /<final\b[^>]*>([\s\S]*?)<\/final>/gi;

export function stripThinkingTags(content: string): StripThinkingTagsResult {
  const thinkingMatches: string[] = [];
  let cleanContent = content;

  for (const pattern of THINKING_BLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    cleanContent = cleanContent.replace(pattern, (_match, captured: string) => {
      const thinking = captured.trim();
      if (thinking) {
        thinkingMatches.push(thinking);
      }
      return "";
    });
  }

  const finalMatches: string[] = [];
  FINAL_BLOCK_PATTERN.lastIndex = 0;
  cleanContent.replace(FINAL_BLOCK_PATTERN, (_match, captured: string) => {
    const finalContent = captured.trim();
    if (finalContent) {
      finalMatches.push(finalContent);
    }
    return "";
  });

  if (thinkingMatches.length === 0) {
    const danglingThinking = cleanContent.match(/<(?:thinking|think)\b[^>]*>([\s\S]*)$/i);
    if (danglingThinking?.[1]) {
      const thinking = danglingThinking[1]
        .replace(FINAL_BLOCK_PATTERN, "")
        .replace(/<\/?(?:final|thinking|think)\b[^>]*>/gi, "")
        .trim();
      if (thinking) {
        thinkingMatches.push(thinking);
      }
    }
  }

  let visibleContent =
    finalMatches.length > 0
      ? finalMatches.join("\n\n")
      : stripDanglingAssistantMarkup(cleanContent);

  if (thinkingMatches.length === 0) {
    const lines = visibleContent.split("\n");
    const thinkingLines: string[] = [];
    const nonThinkingLines: string[] = [];
    let inThinkingBlock = false;

    for (const line of lines) {
      if (line.trim().startsWith("<thinking>") || line.trim().startsWith("<think>")) {
        inThinkingBlock = true;
        continue;
      }
      if (line.trim().startsWith("</thinking>") || line.trim().startsWith("</think>")) {
        inThinkingBlock = false;
        continue;
      }
      if (
        inThinkingBlock ||
        line.trim().match(/^(The user|Let me|I can|First|Step|So |Answer:)/i)
      ) {
        thinkingLines.push(line);
      } else {
        nonThinkingLines.push(line);
      }
    }

    if (thinkingLines.length > 2 && thinkingLines.length < lines.length * 0.5) {
      visibleContent = nonThinkingLines.join("\n").trim();
      thinkingMatches.push(thinkingLines.join("\n"));
    }
  }

  return {
    content: stripDanglingAssistantMarkup(stripTextToolCallMarkup(visibleContent)).trim(),
    thinking: thinkingMatches.join("\n\n"),
  };
}

function stripDanglingAssistantMarkup(content: string): string {
  return stripTextToolCallMarkup(content)
    .replace(/<(?:thinking|think)\b[^>]*>[\s\S]*$/i, "")
    .replace(/\[thinking\][\s\S]*$/i, "")
    .replace(/<\/?(?:thinking|think|final)\b[^>]*>/gi, "")
    .replace(/\[\/?thinking\]/gi, "");
}
