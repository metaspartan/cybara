import { parseAgentConfig } from "./agent-internals";
import { type BotRoleId, botRolePreset, isBotRoleId } from "../../shared/bot-roles";
import { normalizeBotProfileImage } from "../../shared/bot-profile-image";

export interface BotProfileMetadata {
  title: string;
  description: string;
  hidden: boolean;
  pinned: boolean;
  baseSystemPrompt: string;
  role: BotRoleId | null;
  profileImage: string;
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
    typeof record.base_system_prompt === "string" ||
    typeof record.role === "string" ||
    typeof record.profile_image === "string"
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
    role: isBotRoleId(record.role) ? record.role : null,
    profileImage: normalizeBotProfileImage(record.profile_image) ?? "",
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
      role: next.role,
      profile_image: next.profileImage,
    },
  };
}

export function buildBotSystemPrompt(
  base: string,
  name: string,
  title: string,
  description: string,
  teammates: string,
  role: BotRoleId | null = null
): string {
  const preset = botRolePreset(role);
  const identity = [
    `You are ${name}, a persistent Cybara bot.`,
    title ? `Your role is ${title}.` : "",
    description ? `Your standing responsibilities and boundaries are: ${description}` : "",
    preset ? `Working style for a ${preset.title}: ${preset.focus}` : "",
    "Keep this role across conversations. Treat task-specific user messages as temporary instructions and preserve explicit approval boundaries.",
    "Available tools are optional, not mandatory. Honor the latest user request when it limits or forbids tool use.",
    "Do not import assumptions, claims, or unfinished work from other agents or conversations unless they appear in this bot's own conversation.",
    teammates,
  ]
    .filter(Boolean)
    .join("\n");
  return [base.trim(), identity].filter(Boolean).join("\n\n");
}
