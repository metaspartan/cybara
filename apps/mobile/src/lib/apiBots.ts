import type { CybaraMobileApi } from "./api";
import { asRecord, normalizeArrayResponse, readNumber, readString } from "./apiNormalizeUtils";
import type { BotRoleId } from "cybara-shared/bot-roles";
import { isBotRoleId } from "cybara-shared/bot-roles";
import { isRoomDiscussionMode, type RoomDiscussionMode } from "cybara-shared/room-mode";

export interface MobileBotSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  role: BotRoleId | null;
  hidden: boolean;
  pinned: boolean;
  model?: string;
  provider?: string;
  providerId?: string;
  status?: string;
  mentionHandle?: string;
  toolCount: number;
  memoryEnabled: boolean;
  routineCount: number;
  activeRoutineCount: number;
  sessionId: string;
  sessionTitle: string | null;
  sessionUpdatedAt?: string;
  sessionMessageCount: number;
  lastMessage: { role: string; content: string } | null;
}

export interface MobileRoomConfig {
  participantAgentIds: string[];
  mode: RoomDiscussionMode;
  maxRounds: number;
  moderatorAgentId: string | null;
  sharedContext: string;
}

export interface MobileRoomParticipant {
  id: string;
  name: string;
  handle: string;
  model?: string;
}

export interface MobileRoomSummary extends MobileRoomConfig {
  sessionId: string;
  title: string;
  participants: MobileRoomParticipant[];
}

export interface MobileBotRoleOption {
  id: BotRoleId;
  title: string;
  description: string;
}

export interface CreateMobileBotInput {
  name: string;
  role?: BotRoleId | null;
  title?: string;
  description?: string;
  baseAgentId?: string;
  model?: string;
  providerId?: string;
}

export interface CreateMobileRoomInput {
  participantAgentIds: string[];
  mode?: RoomDiscussionMode;
  maxRounds?: number;
  moderatorAgentId?: string | null;
  title?: string;
}

export function normalizeMobileRoomConfig(value: unknown): MobileRoomConfig | null {
  const record = asRecord(value);
  if (!record) return null;
  const participantAgentIds = normalizeArrayResponse(
    record.participant_agent_ids ?? record.participantAgentIds,
    []
  ).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  if (participantAgentIds.length === 0) return null;
  const mode = readString(record, ["mode"]);
  const moderator = readString(record, ["moderator_agent_id", "moderatorAgentId"]);
  return {
    participantAgentIds,
    mode: isRoomDiscussionMode(mode) ? mode : "round_robin",
    maxRounds: readNumber(record, ["max_rounds", "maxRounds"]) ?? 1,
    moderatorAgentId: moderator || null,
    sharedContext: readString(record, ["shared_context", "sharedContext"]) || "",
  };
}

export function normalizeMobileRoomSummary(value: unknown): MobileRoomSummary | null {
  const record = asRecord(value);
  const config = normalizeMobileRoomConfig(record);
  const sessionId = readString(record, ["session_id", "sessionId"]);
  if (!record || !config || !sessionId) return null;
  return {
    ...config,
    sessionId,
    title: readString(record, ["title"]) || "Group room",
    participants: normalizeArrayResponse(record.participants, ["participants"]).map((entry) => {
      const participant = asRecord(entry);
      const id = readString(participant, ["id"]) || "";
      return {
        id,
        name: readString(participant, ["name"]) || id,
        handle: readString(participant, ["handle"]) || id,
        model: readString(participant, ["model"]),
      };
    }),
  };
}

export function normalizeMobileBot(value: unknown, index = 0): MobileBotSummary {
  const record = asRecord(value);
  const session = asRecord(record?.session);
  const id = readString(record, ["id"]) || `bot-${index + 1}`;
  const role = readString(record, ["role"]);
  return {
    id,
    name: readString(record, ["name"]) || "Bot",
    title: readString(record, ["title"]) || "Assistant",
    description: readString(record, ["description"]) || "",
    role: isBotRoleId(role) ? role : null,
    hidden: record?.hidden === true,
    pinned: record?.pinned === true,
    model: readString(record, ["model"]),
    provider: readString(record, ["provider"]),
    providerId: readString(record, ["provider_id", "providerId"]),
    status: readString(record, ["status"]),
    mentionHandle: readString(record, ["mention_handle", "mentionHandle"]),
    toolCount: readNumber(record, ["tool_count", "toolCount"]) ?? 0,
    memoryEnabled: record?.memory_enabled !== false,
    routineCount: readNumber(record, ["routine_count", "routineCount"]) ?? 0,
    activeRoutineCount: readNumber(record, ["active_routine_count", "activeRoutineCount"]) ?? 0,
    sessionId: readString(record, ["session_id", "sessionId"]) || `bot:${id}`,
    sessionTitle: readString(session, ["title"]) || null,
    sessionUpdatedAt: readString(session, ["updated_at", "updatedAt"]),
    sessionMessageCount: readNumber(session, ["message_count", "messageCount"]) ?? 0,
    lastMessage:
      (asRecord(session?.last_message ?? session?.lastMessage) as
        | MobileBotSummary["lastMessage"]
        | null) ?? null,
  };
}

export async function listMobileBots(api: CybaraMobileApi): Promise<MobileBotSummary[]> {
  const response = await api.request<{ bots?: unknown }>("/api/bots");
  return normalizeArrayResponse(response.bots, ["bots"]).map(normalizeMobileBot);
}

export async function listMobileBotRoles(api: CybaraMobileApi): Promise<MobileBotRoleOption[]> {
  const response = await api.request<{ roles?: unknown }>("/api/bots/roles");
  return normalizeArrayResponse(response.roles, ["roles"]).flatMap((entry) => {
    const record = asRecord(entry);
    const id = readString(record, ["id"]);
    if (!isBotRoleId(id)) return [];
    return [
      {
        id,
        title: readString(record, ["title"]) || id,
        description: readString(record, ["description"]) || "",
      },
    ];
  });
}

export async function createMobileBot(
  api: CybaraMobileApi,
  input: CreateMobileBotInput
): Promise<MobileBotSummary> {
  const response = await api.request<{ bot?: unknown }>("/api/bots", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      role: input.role ?? undefined,
      title: input.title,
      description: input.description,
      base_agent_id: input.baseAgentId,
      model: input.model,
      provider_id: input.providerId,
    }),
  });
  return normalizeMobileBot(response.bot);
}

export async function updateMobileBot(
  api: CybaraMobileApi,
  id: string,
  input: Partial<CreateMobileBotInput> & { hidden?: boolean; pinned?: boolean }
): Promise<MobileBotSummary> {
  const response = await api.request<{ bot?: unknown }>(`/api/bots/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: input.name,
      role: input.role,
      title: input.title,
      description: input.description,
      hidden: input.hidden,
      pinned: input.pinned,
      model: input.model,
      provider_id: input.providerId,
    }),
  });
  return normalizeMobileBot(response.bot);
}

export async function deleteMobileBot(api: CybaraMobileApi, id: string): Promise<void> {
  await api.request(`/api/bots/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function ensureMobileBotSession(api: CybaraMobileApi, id: string): Promise<string> {
  const response = await api.request<{ session_id?: string }>(
    `/api/bots/${encodeURIComponent(id)}/session`,
    { method: "POST" }
  );
  return response.session_id || `bot:${id}`;
}

export async function createMobileRoom(
  api: CybaraMobileApi,
  input: CreateMobileRoomInput
): Promise<MobileRoomSummary> {
  const response = await api.request<{ room?: unknown }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      participant_agent_ids: input.participantAgentIds,
      mode: input.mode,
      max_rounds: input.maxRounds,
      moderator_agent_id: input.moderatorAgentId,
      title: input.title,
    }),
  });
  const room = normalizeMobileRoomSummary(response.room);
  if (!room) throw new Error("Room could not be created");
  return room;
}

export async function updateMobileRoom(
  api: CybaraMobileApi,
  sessionId: string,
  input: Partial<CreateMobileRoomInput>
): Promise<MobileRoomSummary> {
  const response = await api.request<{ room?: unknown }>(
    `/api/rooms/${encodeURIComponent(sessionId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        participant_agent_ids: input.participantAgentIds,
        mode: input.mode,
        max_rounds: input.maxRounds,
        moderator_agent_id: input.moderatorAgentId,
        title: input.title,
      }),
    }
  );
  const room = normalizeMobileRoomSummary(response.room);
  if (!room) throw new Error("Room could not be updated");
  return room;
}

export async function speakInMobileRoom(
  api: CybaraMobileApi,
  sessionId: string,
  agentId: string
): Promise<void> {
  await api.request(`/api/rooms/${encodeURIComponent(sessionId)}/speak`, {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
  });
}
