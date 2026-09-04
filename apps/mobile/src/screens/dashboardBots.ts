import { BOT_ROLE_PRESETS } from "cybara-shared/bot-roles";
import { isBotSessionId } from "cybara-shared/bot-mode";
import { isRoomSessionId, ROOM_MODE_LABELS } from "cybara-shared/room-mode";
import type { MobileBotSummary, MobileRoomConfig } from "../lib/apiBots";
import type { SessionSummary } from "../lib/api-types";
import { compactLastUpdatedLabel } from "../lib/dashboard";

const BOT_COLORS = [
  ["#a855f7", "#6d28d9"],
  ["#06b6d4", "#0e7490"],
  ["#f43f5e", "#be123c"],
  ["#22c55e", "#15803d"],
  ["#f59e0b", "#b45309"],
  ["#3b82f6", "#1d4ed8"],
] as const;

export function botAvatarColors(id: string): readonly [string, string] {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return BOT_COLORS[hash % BOT_COLORS.length];
}

export function botAvatarInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "AI";
}

function timeValue(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortMobileBots(bots: readonly MobileBotSummary[]): MobileBotSummary[] {
  return [...bots].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const byTime = timeValue(right.sessionUpdatedAt) - timeValue(left.sessionUpdatedAt);
    return byTime || left.name.localeCompare(right.name);
  });
}

export function filterMobileBots(
  bots: readonly MobileBotSummary[],
  query: string,
  showHidden: boolean
): MobileBotSummary[] {
  const normalized = query.trim().toLowerCase();
  return sortMobileBots(bots).filter((bot) => {
    if (bot.hidden && !showHidden) return false;
    if (!normalized) return true;
    return [bot.name, bot.title, bot.description, bot.model, bot.mentionHandle]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
}

export function botRoleLabel(bot: Pick<MobileBotSummary, "role" | "title">): string {
  if (bot.role && BOT_ROLE_PRESETS[bot.role]) return BOT_ROLE_PRESETS[bot.role].title;
  return bot.title;
}

export function botPreviewText(bot: MobileBotSummary): string {
  const message = bot.lastMessage?.content?.trim();
  return message || bot.description || bot.title;
}

export function roomSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return sessions.filter((session) => isRoomSessionId(session.id));
}

export function nonRoomSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return sessions.filter((session) => !isRoomSessionId(session.id));
}

export function standaloneChatSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return sessions.filter((session) => !isRoomSessionId(session.id) && !isBotSessionId(session.id));
}

export function roomModeSummary(config: Pick<MobileRoomConfig, "mode" | "maxRounds">): string {
  const rounds = config.maxRounds === 1 ? "1 round" : `${config.maxRounds} rounds`;
  return `${ROOM_MODE_LABELS[config.mode]} · ${rounds}`;
}

export function roomParticipantNames(
  config: Pick<MobileRoomConfig, "participantAgentIds">,
  bots: readonly MobileBotSummary[],
  agents: readonly { id: string; name: string }[]
): string[] {
  return config.participantAgentIds.map(
    (id) =>
      bots.find((bot) => bot.id === id)?.name ??
      agents.find((agent) => agent.id === id)?.name ??
      id.slice(0, 8)
  );
}

export function botUpdatedLabel(bot: Pick<MobileBotSummary, "id" | "sessionUpdatedAt">): string {
  if (!bot.sessionUpdatedAt) return "";
  return compactLastUpdatedLabel({
    id: bot.id,
    title: null,
    message_count: 0,
    updated_at: bot.sessionUpdatedAt,
  });
}
