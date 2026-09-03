import { fetchApi } from "@/lib/api-client";
import type { ChatMessage, RoomSummary, SessionRoomMode } from "@/types";

export interface RoomInput {
  participant_agent_ids?: string[];
  mode?: SessionRoomMode;
  max_rounds?: number;
  moderator_agent_id?: string | null;
  shared_context?: string;
  title?: string;
  workspace_dir?: string | null;
}

export const roomsApi = {
  modes: () =>
    fetchApi<{
      modes: Array<{ id: SessionRoomMode; label: string; description: string }>;
      max_participants: number;
      max_rounds: number;
    }>("/rooms/modes"),
  create: (input: RoomInput & { participant_agent_ids: string[] }) =>
    fetchApi<{ success: boolean; room: RoomSummary }>("/rooms", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  get: (sessionId: string) =>
    fetchApi<{ room: RoomSummary }>(`/rooms/${encodeURIComponent(sessionId)}`),
  update: (sessionId: string, input: RoomInput) =>
    fetchApi<{ success: boolean; room: RoomSummary }>(`/rooms/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  speak: (sessionId: string, agentId: string) =>
    fetchApi<{ sessionId: string; message: ChatMessage; messages?: ChatMessage[] }>(
      `/rooms/${encodeURIComponent(sessionId)}/speak`,
      {
        method: "POST",
        body: JSON.stringify({ agent_id: agentId }),
      }
    ),
};
