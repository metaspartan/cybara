import { Check, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Modal } from "@/components/ui";
import { useAgentSummaries } from "@/hooks/useApi";
import { useCreateRoom } from "@/hooks/useRooms";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SessionRoomMode } from "@/types";
import {
  ROOM_DISCUSSION_MODES,
  ROOM_MAX_PARTICIPANTS,
  ROOM_MAX_ROUNDS,
  ROOM_MODE_DESCRIPTIONS,
  ROOM_MODE_LABELS,
} from "../../../../shared/room-mode";
import { agentAvatarGradient, agentAvatarInitials } from "./BotAvatar";
import { buildSessionChatPath } from "./chatRoute";

interface RoomCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceDir?: string | null;
  botsOnly?: boolean;
}

export function RoomCreateModal({
  isOpen,
  onClose,
  workspaceDir,
  botsOnly = false,
}: RoomCreateModalProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: agents = [] } = useAgentSummaries();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<SessionRoomMode>("round_robin");
  const [maxRounds, setMaxRounds] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const selectable = useMemo(
    () =>
      agents.filter(
        (agent) =>
          agent.type !== "subagent" && agent.type !== "worker" && (!botsOnly || agent.is_bot)
      ),
    [agents, botsOnly]
  );
  const createRoom = useCreateRoom({
    onCreated: (room) => {
      setSelectedIds([]);
      setError(null);
      onClose();
      navigate(buildSessionChatPath(room.session_id));
    },
  });

  const toggle = (id: string): void => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= ROOM_MAX_PARTICIPANTS) return current;
      return [...current, id];
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("chat.room.startRoom")}
      description={t("chat.room.createDescription", { max: ROOM_MAX_PARTICIPANTS })}
      size="sm"
    >
      <div className="space-y-3">
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {selectable.map((agent) => {
            const selected = selectedIds.includes(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggle(agent.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-[rgba(var(--accent-primary),0.38)] bg-[rgba(var(--accent-primary),0.12)]"
                    : "border-[var(--surface-border)] hover:bg-[var(--surface-raised)]"
                )}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[11px] font-semibold text-white"
                  style={{ background: agentAvatarGradient(agent.id) }}
                  aria-hidden="true"
                >
                  {agentAvatarInitials(agent.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                    {agent.name}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--text-muted)]">
                    {agent.model || agent.provider || ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    selected
                      ? "border-[rgb(var(--accent-primary))] bg-[rgb(var(--accent-primary))] text-white"
                      : "border-[var(--surface-border)] text-transparent"
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ROOM_DISCUSSION_MODES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              title={ROOM_MODE_DESCRIPTIONS[option]}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                mode === option
                  ? "border-[rgba(var(--accent-primary),0.5)] bg-[rgba(var(--accent-primary),0.14)] text-[var(--text-primary)]"
                  : "border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              {ROOM_MODE_LABELS[option]}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
          <span className="min-w-0 flex-1">{ROOM_MODE_DESCRIPTIONS[mode]}</span>
          <label className="flex shrink-0 items-center gap-2">
            {t("chat.room.rounds")}
            <select
              value={maxRounds}
              onChange={(event) => setMaxRounds(Number(event.target.value))}
              className="rounded-md border border-[var(--surface-border)] bg-[var(--surface-base)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
            >
              {Array.from({ length: ROOM_MAX_ROUNDS }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            type="button"
            leftIcon={<UsersRound className="h-4 w-4" />}
            isLoading={createRoom.isPending}
            disabled={selectedIds.length < 2}
            onClick={() =>
              createRoom.mutate(
                {
                  participant_agent_ids: selectedIds,
                  mode,
                  max_rounds: maxRounds,
                  workspace_dir: workspaceDir ?? undefined,
                },
                { onError: (mutationError: Error) => setError(mutationError.message) }
              )
            }
          >
            {t("chat.room.startRoom")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
