import { stripTextToolCallMarkup } from "../core/llm/text-tool-calls";

export interface StripThinkingTagsResult {
  content: string;
  thinking: string;
}

const REASONING_TAG_NAME_PATTERN =
  "REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning";
const REASONING_BLOCK_PATTERN = new RegExp(
  `<(${REASONING_TAG_NAME_PATTERN})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`,
  "gi"
);
const BRACKET_REASONING_BLOCK_PATTERN =
  /\[(?:thinking|reasoning)\]([\s\S]*?)\[\/(?:thinking|reasoning)\]/gi;
const DANGLING_REASONING_PATTERN = new RegExp(
  `<(?:${REASONING_TAG_NAME_PATTERN})\\b[^>]*>([\\s\\S]*)$`,
  "i"
);
const REASONING_TAG_PATTERN = new RegExp(
  `<\\/?(?:${REASONING_TAG_NAME_PATTERN}|final)\\b[^>]*>`,
  "gi"
);
const REASONING_OPEN_LINE_PATTERN = new RegExp(`^<(?:${REASONING_TAG_NAME_PATTERN})\\b[^>]*>`, "i");
const REASONING_CLOSE_LINE_PATTERN = new RegExp(`^<\\/(?:${REASONING_TAG_NAME_PATTERN})>`, "i");

const FINAL_BLOCK_PATTERN = /<final\b[^>]*>([\s\S]*?)<\/final>/gi;

export function stripThinkingTags(content: string): StripThinkingTagsResult {
  const thinkingMatches: string[] = [];
  let cleanContent = content;

  REASONING_BLOCK_PATTERN.lastIndex = 0;
  cleanContent = cleanContent.replace(
    REASONING_BLOCK_PATTERN,
    (_match, _tagName: string, captured: string) => {
      const thinking = captured.trim();
      if (thinking) {
        thinkingMatches.push(thinking);
      }
      return "";
    }
  );

  BRACKET_REASONING_BLOCK_PATTERN.lastIndex = 0;
  cleanContent = cleanContent.replace(
    BRACKET_REASONING_BLOCK_PATTERN,
    (_match, captured: string) => {
      const thinking = captured.trim();
      if (thinking) {
        thinkingMatches.push(thinking);
      }
      return "";
    }
  );

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
    const danglingThinking = cleanContent.match(DANGLING_REASONING_PATTERN);
    if (danglingThinking?.[1]) {
      const thinking = danglingThinking[1]
        .replace(FINAL_BLOCK_PATTERN, "")
        .replace(REASONING_TAG_PATTERN, "")
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
      const trimmedLine = line.trim();
      if (REASONING_OPEN_LINE_PATTERN.test(trimmedLine)) {
        inThinkingBlock = true;
        continue;
      }
      if (REASONING_CLOSE_LINE_PATTERN.test(trimmedLine)) {
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
    .replace(new RegExp(`<(?:${REASONING_TAG_NAME_PATTERN})\\b[^>]*>[\\s\\S]*$`, "i"), "")
    .replace(/\[(?:thinking|reasoning)\][\s\S]*$/i, "")
    .replace(REASONING_TAG_PATTERN, "")
    .replace(/\[\/?(?:thinking|reasoning)\]/gi, "");
}
