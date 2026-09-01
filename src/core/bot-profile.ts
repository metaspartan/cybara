import { parseAgentConfig } from "./agent-internals";

export interface BotProfileMetadata {
  title: string;
  description: string;
  hidden: boolean;
  pinned: boolean;
  baseSystemPrompt: string;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function botModeRecord(config: unknown): Record<string, unknown> | null {
  const value = parseAgentConfig(config).bot_mode;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isBotProfileConfig(config: unknown): boolean {
  const record = botModeRecord(config);
  if (!record) return false;
  return (
    typeof record.title === "string" ||
    typeof record.description === "string" ||
    typeof record.hidden === "boolean" ||
    typeof record.pinned === "boolean" ||
    typeof record.base_system_prompt === "string"
  );
}

export function readBotProfileMetadata(config: unknown): BotProfileMetadata {
  const record = botModeRecord(config) ?? {};
  return {
    title: boundedText(record.title, 80),
    description: boundedText(record.description, 2_000),
    hidden: record.hidden === true,
    pinned: record.pinned === true,
    baseSystemPrompt: boundedText(record.base_system_prompt, 20_000),
  };
}

export function withBotProfileMetadata(
  config: unknown,
  updates: Partial<BotProfileMetadata>
): Record<string, unknown> {
  const root = parseAgentConfig(config);
  const current = readBotProfileMetadata(root);
  const next = { ...current, ...updates };
  return {
    ...root,
    bot_mode: {
      title: next.title,
      description: next.description,
      hidden: next.hidden,
      pinned: next.pinned,
      base_system_prompt: next.baseSystemPrompt,
    },
  };
}

export function buildBotSystemPrompt(
  base: string,
  name: string,
  title: string,
  description: string,
  teammates: string
): string {
  const identity = [
    `You are ${name}, a persistent Cybara bot.`,
    title ? `Your role is ${title}.` : "",
    description ? `Your standing responsibilities and boundaries are: ${description}` : "",
    "Keep this role across conversations. Treat task-specific user messages as temporary instructions and preserve explicit approval boundaries.",
    "Available tools are optional, not mandatory. Honor the latest user request when it limits or forbids tool use.",
    "Do not import assumptions, claims, or unfinished work from other agents or conversations unless they appear in this bot's own conversation.",
    teammates,
  ]
    .filter(Boolean)
    .join("\n");
  return [base.trim(), identity].filter(Boolean).join("\n\n");
}
