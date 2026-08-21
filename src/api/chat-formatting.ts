import { hasTextToolCallMarkup, stripTextToolCallMarkup } from "../core/llm/text-tool-calls";
import { isMidLoopContextCompactionDetail } from "../core/llm/context-pressure";

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
const STRICT_JSON_REQUEST_PATTERN =
  /\b(?:strict\s+JSON|(?:output|reply|respond|return|emit)\s+(?:only\s+)?(?:a\s+)?JSON|JSON[\s\S]{0,120}no\s+markdown)\b/i;
const JSON_FENCE_PATTERN = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i;

export function normalizeRequestedAssistantResponse(userMessage: string, content: string): string {
  if (!STRICT_JSON_REQUEST_PATTERN.test(userMessage)) return content;
  const fenced = content.match(JSON_FENCE_PATTERN)?.[1]?.trim();
  if (!fenced) return content;
  try {
    JSON.parse(fenced);
    return fenced;
  } catch {
    return content;
  }
}

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
    thinking: sanitizeProcessThoughtText(thinkingMatches.join("\n\n")),
  };
}

export function sanitizeProcessThoughtText(content: string): string {
  const trimmed = content.trim();
  const withoutToolMarkup = hasTextToolCallMarkup(trimmed)
    ? stripTextToolCallMarkup(trimmed).trim()
    : trimmed;
  if (withoutToolMarkup.length <= 400 && !withoutToolMarkup.includes("\n")) {
    if (isMidLoopContextCompactionDetail(withoutToolMarkup)) return "";
    return withoutToolMarkup.trim();
  }
  const lines = withoutToolMarkup.split(/\r?\n|\u2028|\u2029/);
  const result: string[] = [];
  let previousText = "";
  for (const line of lines) {
    if (isMidLoopContextCompactionDetail(line)) continue;
    const normalized = line.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized && normalized === previousText) continue;
    if (normalized) previousText = normalized;
    if (!normalized && result.at(-1)?.trim() === "") continue;
    result.push(line);
  }
  return result.join("\n").trim();
}

function stripDanglingAssistantMarkup(content: string): string {
  return stripTextToolCallMarkup(content)
    .replace(new RegExp(`<(?:${REASONING_TAG_NAME_PATTERN})\\b[^>]*>[\\s\\S]*$`, "i"), "")
    .replace(/\[(?:thinking|reasoning)\][\s\S]*$/i, "")
    .replace(REASONING_TAG_PATTERN, "")
    .replace(/\[\/?(?:thinking|reasoning)\]/gi, "");
}
