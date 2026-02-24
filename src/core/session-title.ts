export interface SessionTitleMessage {
  role: string;
  content: string;
}

export const MAX_SESSION_TITLE_LENGTH = 140;

const TITLE_WORD_LIMIT = 12;

const ASSISTANT_GENERIC_PREFIXES: RegExp[] = [
  /^(i can|i will|i'll|i am|i'm)\b/i,
  /^(i apologize|sorry)\b/i,
  /^(here(?:'s| is)|let me|sure|absolutely|on it|done)\b/i,
  /^(working|worked for|thinking|generating)\b/i,
  /^(tool:|result:|process\b|ran\b|explored\b)/i,
];

const ASSISTANT_PROMOTED_KEYWORDS =
  /\b(report|audit|analysis|summary|plan|roadmap|fix|implementation|upgrade|refactor|review|artifact|security|metrics)\b/i;

const GENERIC_ASSISTANT_TITLES = new Set([
  "summary",
  "report",
  "analysis",
  "plan",
  "roadmap",
  "response",
  "update",
  "overview",
  "results",
  "findings",
  "notes",
]);

const GENERIC_SESSION_TITLES = new Set([
  ...GENERIC_ASSISTANT_TITLES,
  "session",
  "new chat",
  "chat",
  "conversation",
]);

function cleanTitleText(value: string): string {
  return value
    .replace(/^\s*(?:#+\s*|[-*+]\s+|\d+\.\s+)/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toWordsLimitedTitle(text: string): string {
  const words = text.split(" ").filter(Boolean);
  if (words.length <= TITLE_WORD_LIMIT) return words.join(" ");
  return words.slice(0, TITLE_WORD_LIMIT).join(" ");
}

function toSentenceLead(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const sentence = trimmed.split(/(?<=[.!?])\s+/)[0] || trimmed;
  return sentence.trim().replace(/[.!?]+$/g, "");
}

function stripListPrefix(line: string): string {
  return line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s+|#+\s+)/, "").trim();
}

export function normalizeSessionTitle(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = cleanTitleText(value);
  if (!normalized) return null;
  const compact = toWordsLimitedTitle(normalized);
  if (compact.length <= MAX_SESSION_TITLE_LENGTH) return compact;
  return `${compact.slice(0, MAX_SESSION_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function shouldRegenerateSessionTitle(value?: string | null): boolean {
  const normalized = normalizeSessionTitle(value);
  if (!normalized) return true;
  const lowered = normalized.trim().toLowerCase();
  return GENERIC_SESSION_TITLES.has(lowered);
}

function summarizeUserMessageForTitle(userMessage?: string): string | null {
  if (typeof userMessage !== "string" || !userMessage.trim()) return null;
  const normalized = cleanTitleText(
    userMessage
      .replace(/^@\S+\s*/g, "")
      .replace(/^(?:hey|hi|hello)\b[,\s-]*/i, "")
      .replace(/^please\b[,\s-]*/i, "")
      .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, "")
      .replace(/^(?:i\s+need\s+you\s+to|help\s+me\s+)\s*/i, "")
  );
  if (!normalized) return null;
  return normalizeSessionTitle(toSentenceLead(normalized));
}

function isGenericAssistantLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) return true;
  return ASSISTANT_GENERIC_PREFIXES.some((pattern) => pattern.test(normalized));
}

function isOverlyGenericAssistantTitle(line: string): boolean {
  const normalized = cleanTitleText(
    line
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/[:\-–—]\s*$/, "")
  ).toLowerCase();
  if (!normalized) return true;
  if (GENERIC_ASSISTANT_TITLES.has(normalized)) return true;
  if (
    /^(summary|report|analysis|plan|overview)\s+of\s+this\s+(chat|conversation)$/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

function summarizeAssistantMessageForTitle(assistantMessage?: string): string | null {
  if (typeof assistantMessage !== "string" || !assistantMessage.trim()) return null;

  const rawLines = assistantMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 24);
  if (rawLines.length === 0) return null;

  const processedLines = rawLines
    .map((line) => stripListPrefix(line))
    .map((line) => cleanTitleText(line))
    .filter(Boolean);
  if (processedLines.length === 0) return null;

  const headingCandidate = processedLines.find(
    (line, index) =>
      index < 6 && !isGenericAssistantLine(line) && ASSISTANT_PROMOTED_KEYWORDS.test(line)
  );
  const firstMeaningfulLine = processedLines.find((line) => !isGenericAssistantLine(line));

  const chosenLine = headingCandidate || firstMeaningfulLine || processedLines[0];
  const cleaned = cleanTitleText(
    chosenLine
      .replace(/^(?:title|session title)\s*:\s*/i, "")
      .replace(/^(?:i(?:'ve| have)?\s+|i\s+)/i, "")
      .replace(/^(?:here(?:'s| is)\s+|let me\s+|sure[,!\s-]*)/i, "")
      .replace(/^(?:completed\s+\d+\s+tool\s+calls:?)/i, "")
  );
  if (!cleaned) return null;
  if (isOverlyGenericAssistantTitle(cleaned)) return null;

  return normalizeSessionTitle(toSentenceLead(cleaned));
}

export function parseModelGeneratedSessionTitle(modelOutput?: string | null): string | null {
  if (typeof modelOutput !== "string" || !modelOutput.trim()) return null;

  const raw = cleanTitleText(modelOutput);
  const lines = modelOutput
    .split(/\r?\n/)
    .map((line) => stripListPrefix(line))
    .map((line) => cleanTitleText(line))
    .filter(Boolean);

  const candidates = [raw, ...lines]
    .map((line) =>
      line
        .replace(/^['"`]+|['"`]+$/g, "")
        .replace(/^(?:title|session title|chat title|suggested title)\s*:\s*/i, "")
        .replace(
          /^(?:the\s+)?(?:best\s+)?(?:session|chat)?\s*title\s*(?:is|would be)\s*/i,
          ""
        )
        .trim()
    )
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizeSessionTitle(candidate);
    if (!normalized) continue;
    if (shouldRegenerateSessionTitle(normalized)) continue;
    return normalized;
  }

  return null;
}

export function deriveSessionTitleFromMessages(
  messages: SessionTitleMessage[],
  agentName?: string | null
): string {
  const firstUser = messages.find(
    (message) =>
      message.role === "user" && typeof message.content === "string" && message.content.trim()
  );
  const firstAssistant = messages.find(
    (message) =>
      message.role === "assistant" && typeof message.content === "string" && message.content.trim()
  );

  const assistantTitle = summarizeAssistantMessageForTitle(firstAssistant?.content);
  if (assistantTitle) return assistantTitle;

  const userTitle = summarizeUserMessageForTitle(firstUser?.content);
  if (userTitle) return userTitle;

  const normalizedAgentName = normalizeSessionTitle(agentName);
  if (normalizedAgentName) {
    return normalizeSessionTitle(`${normalizedAgentName} session`) || "Session";
  }

  return "Session";
}

export function deriveSessionTitleFromTurn(
  userMessage: string,
  assistantMessage?: string,
  agentName?: string | null
): string {
  const messages: SessionTitleMessage[] = [];
  if (typeof userMessage === "string" && userMessage.trim()) {
    messages.push({ role: "user", content: userMessage });
  }
  if (typeof assistantMessage === "string" && assistantMessage.trim()) {
    messages.push({ role: "assistant", content: assistantMessage });
  }
  return deriveSessionTitleFromMessages(messages, agentName);
}
