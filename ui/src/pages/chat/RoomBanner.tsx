import { useMutation } from "@tanstack/react-query";
import { useAgentSummaries } from "@/hooks/useApi";
import { useSessionDetail } from "@/hooks/useChat";
import { isRoomSessionId } from "../../../../shared/room-mode";
import { agentAvatarGradient, agentAvatarInitials } from "./BotAvatar";
import { Loader2, MessageSquareOff, Settings2, UsersRound } from "lucide-react";
import { useState } from "react";
import { extractApiError, roomsApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
import type { AgentSummary, SessionRoomConfig, SessionRoomMode } from "@/types";
import {
  ROOM_DISCUSSION_MODES,
  ROOM_MAX_ROUNDS,
  ROOM_MODE_DESCRIPTIONS,
  ROOM_MODE_LABELS,
} from "../../../../shared/room-mode";

interface RoomBannerProps {
  sessionId: string;
  room: SessionRoomConfig;
  agents: AgentSummary[];
  busy: boolean;
  onStop: () => void;
  onRoomChanged: () => void;
}

export function useCurrentRoom(sessionId: string | null | undefined): SessionRoomConfig | null {
  const roomSessionId = sessionId && isRoomSessionId(sessionId) ? sessionId : "";
  const { data } = useSessionDetail(roomSessionId, Boolean(roomSessionId));
  return roomSessionId ? (data?.room ?? null) : null;
}

export function ChatRoomBanner({
  sessionId,
  ...props
}: Omit<RoomBannerProps, "room" | "sessionId" | "agents"> & { sessionId: string | null }) {
  const room = useCurrentRoom(sessionId);
  const { data: agents = [] } = useAgentSummaries();
  if (!room || !sessionId) return null;
  return <RoomBanner sessionId={sessionId} room={room} agents={agents} {...props} />;
}

const ROOM_COLORS = [
  ["#a855f7", "#6d28d9"],
  ["#06b6d4", "#0e7490"],
  ["#f43f5e", "#be123c"],
  ["#22c55e", "#15803d"],
  ["#f59e0b", "#b45309"],
  ["#3b82f6", "#1d4ed8"],
] as const;

function colorFor(id: string): readonly [string, string] {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return ROOM_COLORS[hash % ROOM_COLORS.length];
}

export function RoomBanner({
  sessionId,
  room,
  agents,
  busy,
  onStop,
  onRoomChanged,
}: RoomBannerProps) {
  const { t } = useI18n();
  const addToast = useUIStore((state) => state.addToast);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const participants = room.participant_agent_ids
    .map((id) => agents.find((agent) => agent.id === id) ?? { id, name: id })
    .filter((agent): agent is AgentSummary => Boolean(agent));

  const speak = useMutation({
    mutationFn: async (agentId: string) => {
      const response = await roomsApi.speak(sessionId, agentId);
      if (!response.success) throw new Error(extractApiError(response, "Could not ask agent"));
      return response.data;
    },
    onError: (error: Error) => addToast("error", error.message),
  });

  const update = useMutation({
    mutationFn: async (patch: Partial<SessionRoomConfig>) => {
      const response = await roomsApi.update(sessionId, {
        mode: patch.mode,
        max_rounds: patch.max_rounds,
        moderator_agent_id: patch.moderator_agent_id,
        shared_context: patch.shared_context,
        participant_agent_ids: patch.participant_agent_ids,
      });
      if (!response.success) throw new Error(extractApiError(response, "Could not update room"));
      return response.data;
    },
    onSuccess: () => onRoomChanged(),
    onError: (error: Error) => addToast("error", error.message),
  });

  const toggleParticipant = (agentId: string): void => {
    const current = room.participant_agent_ids;
    const next = current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId];
    if (next.length === 0) return;
    update.mutate({ participant_agent_ids: next });
  };

  return (
    <div
      data-testid="room-banner"
      className="mx-3 mt-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-raised)] px-3 py-2.5 text-[var(--text-primary)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          <UsersRound className="h-3.5 w-3.5" />
          {t("chat.room.participants")}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {participants.map((agent) => {
            const speaking = speak.isPending && speak.variables === agent.id;
            return (
              <button
                key={agent.id}
                type="button"
                disabled={busy || speak.isPending}
                onClick={() => speak.mutate(agent.id)}
                title={t("chat.room.askToSpeak", { name: agent.name })}
                className="group inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--surface-border)] bg-[var(--surface-base)] pl-1 pr-2.5 text-[11px] font-medium transition-colors hover:border-[rgba(var(--accent-primary),0.5)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                  style={{ background: agentAvatarGradient(agent.id) }}
                  aria-hidden="true"
                >
                  {agentAvatarInitials(agent.name)}
                </span>
                <span className="truncate">{agent.name}</span>
                {speaking ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </button>
            );
          })}
        </div>
        <span
          className="rounded-full border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
          title={ROOM_MODE_DESCRIPTIONS[room.mode]}
        >
          {ROOM_MODE_LABELS[room.mode]} · {room.max_rounds}{" "}
          {room.max_rounds === 1 ? "round" : "rounds"}
        </span>
        <button
          type="button"
          onClick={() => setSettingsOpen((value) => !value)}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]",
            settingsOpen && "border-[var(--surface-border)] text-[var(--text-primary)]"
          )}
          title={t("chat.room.settings")}
          aria-label={t("chat.room.settings")}
          aria-expanded={settingsOpen}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/20"
          >
            <MessageSquareOff className="h-3.5 w-3.5" />
            {t("chat.room.endDiscussion")}
          </button>
        ) : null}
      </div>
      {settingsOpen ? (
        <div className="mt-3 grid gap-3 border-t border-[var(--surface-border)] pt-3 text-[12px] md:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {ROOM_DISCUSSION_MODES.map((mode: SessionRoomMode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ mode })}
                  title={ROOM_MODE_DESCRIPTIONS[mode]}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    room.mode === mode
                      ? "border-[rgba(var(--accent-primary),0.5)] bg-[rgba(var(--accent-primary),0.14)] text-[var(--text-primary)]"
                      : "border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  )}
                >
                  {ROOM_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              {ROOM_MODE_DESCRIPTIONS[room.mode]}
            </p>
            {room.mode === "moderated" ? (
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                {t("chat.room.moderator")}
                <select
                  value={room.moderator_agent_id ?? ""}
                  disabled={update.isPending}
                  onChange={(event) => update.mutate({ moderator_agent_id: event.target.value })}
                  className="rounded-md border border-[var(--surface-border)] bg-[var(--surface-base)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {agents
                .filter((agent) => agent.type !== "subagent" && agent.type !== "worker")
                .map((agent) => {
                  const selected = room.participant_agent_ids.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      disabled={update.isPending}
                      onClick={() => toggleParticipant(agent.id)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                        selected
                          ? "border-[rgba(var(--accent-primary),0.5)] bg-[rgba(var(--accent-primary),0.14)] text-[var(--text-primary)]"
                          : "border-dashed border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      {selected ? "− " : "+ "}
                      {agent.name}
                    </button>
                  );
                })}
            </div>
          </div>
          <label className="flex items-center gap-2 self-start text-[11px] text-[var(--text-muted)]">
            {t("chat.room.rounds")}
            <select
              value={room.max_rounds}
              disabled={update.isPending}
              onChange={(event) => update.mutate({ max_rounds: Number(event.target.value) })}
              className="rounded-md border border-[var(--surface-border)] bg-[var(--surface-base)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
            >
              {Array.from({ length: ROOM_MAX_ROUNDS }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          </label>
        </div>
      ) : null}
    </div>
  );
}
