import { agentManager } from "../core/agent";
import {
  ROOM_DISCUSSION_MODES,
  ROOM_MAX_PARTICIPANTS,
  ROOM_MAX_ROUNDS,
  ROOM_MODE_DESCRIPTIONS,
  ROOM_MODE_LABELS,
  roomConfigToApi,
} from "../../shared/room-mode";
import {
  type CreateRoomInput,
  createRoomSession,
  getRoomSummary,
  type RoomSessionSummary,
  speakInRoom,
  updateRoomSession,
} from "./chat-room-runtime";
import { decodeRouteParam } from "./route-matcher";
import type { RouteHandler } from "./routes/_shared";

interface RoomRequestBody {
  participant_agent_ids?: unknown;
  participantAgentIds?: unknown;
  mode?: unknown;
  max_rounds?: unknown;
  maxRounds?: unknown;
  moderator_agent_id?: unknown;
  moderatorAgentId?: unknown;
  shared_context?: unknown;
  sharedContext?: unknown;
  title?: unknown;
  workspace_dir?: unknown;
  workspaceDir?: unknown;
  agent_id?: unknown;
  agentId?: unknown;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function roomInputFromBody(body: unknown): Partial<CreateRoomInput> {
  const data = (body || {}) as RoomRequestBody;
  const mode = optionalString(data.mode);
  return {
    participantAgentIds: stringList(data.participant_agent_ids ?? data.participantAgentIds),
    mode: mode as CreateRoomInput["mode"] | undefined,
    maxRounds: optionalNumber(data.max_rounds ?? data.maxRounds),
    moderatorAgentId: optionalNullableString(data.moderator_agent_id ?? data.moderatorAgentId),
    sharedContext: optionalString(data.shared_context ?? data.sharedContext),
    title: optionalString(data.title),
    workspaceDir: optionalNullableString(data.workspace_dir ?? data.workspaceDir),
  };
}

export function resolveRoomSessionParam(value: string | undefined): string {
  const trimmed = decodeRouteParam(value?.trim() ?? "");
  if (!trimmed) throw new Error("Validation error: Room id is required");
  return trimmed;
}

function requiredSessionId(params: Record<string, string> | undefined): string {
  return resolveRoomSessionParam(params?.id);
}

export function roomSummaryToApi(summary: RoomSessionSummary) {
  return {
    session_id: summary.sessionId,
    title: summary.title,
    ...roomConfigToApi(summary.config),
    participants: summary.participants,
  };
}

export const roomRoutes: Record<string, RouteHandler> = {
  "GET /api/rooms/modes": () => ({
    modes: ROOM_DISCUSSION_MODES.map((mode) => ({
      id: mode,
      label: ROOM_MODE_LABELS[mode],
      description: ROOM_MODE_DESCRIPTIONS[mode],
    })),
    max_participants: ROOM_MAX_PARTICIPANTS,
    max_rounds: ROOM_MAX_ROUNDS,
  }),
  "POST /api/rooms": async (body) => {
    const input = roomInputFromBody(body);
    if (!input.participantAgentIds || input.participantAgentIds.length === 0) {
      throw new Error("Validation error: participant_agent_ids is required");
    }
    const room = await createRoomSession({
      ...input,
      participantAgentIds: input.participantAgentIds,
    });
    return { success: true, room: roomSummaryToApi(room) };
  },
  "GET /api/rooms/:id": async (_body, params) => {
    const room = await getRoomSummary(requiredSessionId(params));
    if (!room) return { error: "Room not found" };
    return { room: roomSummaryToApi(room) };
  },
  "PUT /api/rooms/:id": async (body, params) => {
    const room = await updateRoomSession(requiredSessionId(params), roomInputFromBody(body));
    return { success: true, room: roomSummaryToApi(room) };
  },
  "POST /api/rooms/:id/speak": async (body, params) => {
    const data = (body || {}) as RoomRequestBody;
    const agentId = optionalString(data.agent_id ?? data.agentId)?.trim();
    if (!agentId) throw new Error("Validation error: agent_id is required");
    if (!agentManager.get(agentId)) throw new Error("Agent not found");
    return await speakInRoom(requiredSessionId(params), agentId);
  },
};
