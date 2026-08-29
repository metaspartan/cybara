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
const EXACT_PLAIN_TEXT_LINE_PATTERN =
  /\breturn\s+exactly\s+one\s+plain-text\s+line\s+with\s+no[\s\S]{0,160}?additional\s+prose\s*:\s*\n([^\r\n]+)/i;

function strictJsonPayload(content: string): string {
  return content.match(JSON_FENCE_PATTERN)?.[1]?.trim() || content.trim();
}

function isValidJson(content: string): boolean {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function repairTruncatedJson(content: string): string | null {
  const closingDelimiters: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of content) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      closingDelimiters.push("}");
    } else if (character === "[") {
      closingDelimiters.push("]");
    } else if (character === "}" || character === "]") {
      if (closingDelimiters.pop() !== character) return null;
    }
  }
  if (inString || closingDelimiters.length === 0) return null;
  const repaired = `${content}${closingDelimiters.reverse().join("")}`;
  return isValidJson(repaired) ? repaired : null;
}

export function isInvalidRequestedJsonResponse(userMessage: string, content: string): boolean {
  if (!STRICT_JSON_REQUEST_PATTERN.test(userMessage)) return false;
  const payload = strictJsonPayload(content);
  return !isValidJson(payload) && repairTruncatedJson(payload) === null;
}

export function normalizeRequestedAssistantResponse(userMessage: string, content: string): string {
  const expectedLine = userMessage.match(EXACT_PLAIN_TEXT_LINE_PATTERN)?.[1]?.trim();
  if (expectedLine) {
    const matchingLine = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line === expectedLine);
    if (matchingLine) return matchingLine;
  }
  if (!STRICT_JSON_REQUEST_PATTERN.test(userMessage)) return content;
  const payload = strictJsonPayload(content);
  if (isValidJson(payload)) return payload;
  return repairTruncatedJson(payload) || content;
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
