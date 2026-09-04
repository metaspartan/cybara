export const ROOM_SESSION_PREFIX = "room:";
export const ROOM_MAX_PARTICIPANTS = 8;
export const ROOM_MAX_ROUNDS = 6;
export const ROOM_PASS_TOKEN = "PASS";

export const ROOM_DISCUSSION_MODES = [
  "round_robin",
  "mention_only",
  "parallel",
  "moderated",
] as const;

export type RoomDiscussionMode = (typeof ROOM_DISCUSSION_MODES)[number];

export interface RoomConfig {
  participantAgentIds: string[];
  mode: RoomDiscussionMode;
  maxRounds: number;
  moderatorAgentId: string | null;
  sharedContext: string;
}

export const ROOM_MODE_LABELS: Record<RoomDiscussionMode, string> = {
  round_robin: "Round robin",
  mention_only: "Mention only",
  parallel: "Parallel",
  moderated: "Moderated",
};

export const ROOM_MODE_DESCRIPTIONS: Record<RoomDiscussionMode, string> = {
  round_robin: "Every participant replies in order, then optional extra rounds until everyone passes.",
  mention_only: "Only @mentioned participants reply. Agents can pull each other in by mention.",
  parallel: "All participants answer at once without seeing each other's reply for that round.",
  moderated: "A moderator agent picks who speaks next and decides when the discussion ends.",
};

export function roomSessionId(id?: string): string {
  const suffix = (id || "").trim() || crypto.randomUUID();
  return `${ROOM_SESSION_PREFIX}${suffix}`;
}

export function isRoomSessionId(sessionId: string | null | undefined): boolean {
  return (
    typeof sessionId === "string" &&
    sessionId.startsWith(ROOM_SESSION_PREFIX) &&
    sessionId.length > ROOM_SESSION_PREFIX.length
  );
}

function uniqueTrimmedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return ids.slice(0, ROOM_MAX_PARTICIPANTS);
}

export function isRoomDiscussionMode(value: unknown): value is RoomDiscussionMode {
  return (
    typeof value === "string" && (ROOM_DISCUSSION_MODES as readonly string[]).includes(value)
  );
}

export function normalizeRoomConfig(value: unknown): RoomConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const participantAgentIds = uniqueTrimmedIds(
    record.participantAgentIds ?? record.participant_agent_ids
  );
  if (participantAgentIds.length === 0) return null;
  const rawMode = record.mode;
  const mode = isRoomDiscussionMode(rawMode) ? rawMode : "round_robin";
  const rawRounds = record.maxRounds ?? record.max_rounds;
  const parsedRounds =
    typeof rawRounds === "number"
      ? rawRounds
      : typeof rawRounds === "string"
        ? Number.parseInt(rawRounds, 10)
        : 1;
  const maxRounds = Number.isFinite(parsedRounds)
    ? Math.min(ROOM_MAX_ROUNDS, Math.max(1, Math.floor(parsedRounds)))
    : 1;
  const rawModerator = record.moderatorAgentId ?? record.moderator_agent_id;
  const moderatorAgentId =
    typeof rawModerator === "string" && rawModerator.trim() ? rawModerator.trim() : null;
  const rawShared = record.sharedContext ?? record.shared_context;
  const sharedContext = typeof rawShared === "string" ? rawShared.trim().slice(0, 4000) : "";
  return {
    participantAgentIds,
    mode,
    maxRounds,
    moderatorAgentId: mode === "moderated" ? moderatorAgentId || participantAgentIds[0] : moderatorAgentId,
    sharedContext,
  };
}

export function parseRoomConfig(serialized: string | null | undefined): RoomConfig | null {
  if (typeof serialized !== "string" || !serialized.trim()) return null;
  try {
    return normalizeRoomConfig(JSON.parse(serialized));
  } catch {
    return null;
  }
}

export function serializeRoomConfig(config: RoomConfig): string {
  return JSON.stringify(config);
}

export function roomConfigToApi(config: RoomConfig) {
  return {
    participant_agent_ids: config.participantAgentIds,
    mode: config.mode,
    max_rounds: config.maxRounds,
    moderator_agent_id: config.moderatorAgentId,
    shared_context: config.sharedContext,
  };
}

export function isRoomPassReply(content: string): boolean {
  const normalized = content
    .trim()
    .replace(/^[\s"'`*_[\]()]+|[\s"'`*_.![\]()]+$/g, "")
    .toUpperCase();
  return normalized === ROOM_PASS_TOKEN;
}
