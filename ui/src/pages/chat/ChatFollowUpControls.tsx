import {
  CircleHelp,
  GripVertical,
  Loader2,
  MessageSquare,
  Pencil,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import type { PendingChatMessage } from "@/lib/status-stream";
import { cn, formatRelativeTime } from "@/lib/utils";

export type ToolApprovalMode = "always_allow" | "ask";

export function normalizeToolApprovalMode(value: unknown): ToolApprovalMode {
  return value === "ask" ? "ask" : "always_allow";
}

function toolApprovalModeLabel(mode: ToolApprovalMode): string {
  return mode === "ask" ? "Ask Me" : "Always Allow";
}

export function ChatApprovalControls({
  mode,
  onChange,
  updating,
}: {
  mode: ToolApprovalMode;
  onChange: (mode: ToolApprovalMode) => void;
  updating?: boolean;
}) {
  const isAskMode = mode === "ask";
  const label = toolApprovalModeLabel(mode);
  const Icon = updating ? Loader2 : isAskMode ? CircleHelp : ShieldAlert;
  const nextMode: ToolApprovalMode = isAskMode ? "always_allow" : "ask";
  return (
    <div className="chat-approval-control relative shrink-0">
      <button
        type="button"
        disabled={updating}
        onClick={() => onChange(nextMode)}
        title={`Tool approvals: ${label} (click to switch)`}
        aria-label={`Tool approvals: ${label}`}
        className="composer-icon-btn chat-approval-toggle inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-transparent px-2 text-gray-400 hover:text-white disabled:opacity-50"
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            updating ? "animate-spin text-gray-400" : isAskMode ? "text-sky-300" : "text-amber-300"
          )}
        />
        <span className="chat-approval-label text-[11px] font-semibold whitespace-nowrap">
          {label}
        </span>
      </button>
    </div>
  );
}

export function PendingChatQueue({
  messages,
  onSteer,
  onReorder,
  onUpdate,
  onDelete,
  steeringMessageId,
  mutatingMessageId,
}: {
  messages: PendingChatMessage[];
  onSteer: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  steeringMessageId: string | null;
  mutatingMessageId: string | null;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  if (messages.length === 0) return null;

  const beginEdit = (message: PendingChatMessage) => {
    setEditingId(message.id);
    setEditingContent(message.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
  };

  const submitEdit = (message: PendingChatMessage) => {
    const nextContent = editingContent.trim();
    if (!nextContent || nextContent === message.content.trim()) {
      cancelEdit();
      return;
    }
    onUpdate(message.id, nextContent);
    cancelEdit();
  };

  const handleEditKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    message: PendingChatMessage
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitEdit(message);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };

  const reorderMessages = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = messages.findIndex((message) => message.id === sourceId);
    const targetIndex = messages.findIndex((message) => message.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...messages];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    onReorder(next.map((message) => message.id));
  };

  return (
    <div data-testid="pending-chat-queue" className="mb-2 w-full min-w-0 space-y-1.5">
      {messages.map((message) => {
        const isSteering = message.mode === "steering";
        const isOptimistic = message.id.startsWith("optimistic-");
        const isMutating = mutatingMessageId === message.id;
        const canChange = !isSteering && !isOptimistic && !isMutating;
        const canDrag = messages.length > 1 && canChange;
        const isEditing = editingId === message.id;
        return (
          <div
            key={message.id}
            data-testid="pending-chat-message"
            onMouseUp={() => {
              if (!draggingId) return;
              reorderMessages(draggingId, message.id);
              setDraggingId(null);
            }}
            className={cn(
              "flex h-11 w-full min-w-0 select-none items-center gap-2 rounded-t-2xl rounded-b-lg border border-white/10 bg-white/[0.055] px-3 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.22)]",
              canDrag ? "cursor-grab active:cursor-grabbing" : "",
              draggingId === message.id ? "opacity-60" : ""
            )}
          >
            {canDrag ? (
              <span
                className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-gray-500"
                title="Drag to reorder"
                aria-label="Drag to reorder queued message"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setDraggingId(message.id);
                }}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            ) : (
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            )}
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                isSteering ? "bg-emerald-500/15 text-emerald-200" : "bg-white/8 text-gray-300"
              )}
            >
              {isSteering ? "Steering" : "Queued"}
            </span>
            {isEditing ? (
              <input
                autoFocus
                value={editingContent}
                onChange={(event) => setEditingContent(event.target.value)}
                onBlur={() => submitEdit(message)}
                onKeyDown={(event) => handleEditKeyDown(event, message)}
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white outline-none focus:border-amber-400/40"
              />
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-gray-300"
                title={`${message.content} · ${formatRelativeTime(new Date(message.createdAt).toISOString())}`}
              >
                {message.content}
              </span>
            )}
            {!isSteering && (
              <>
                <button
                  type="button"
                  onClick={() => beginEdit(message)}
                  disabled={!canChange}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                  title="Edit queued message"
                  aria-label="Edit queued message"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(message.id)}
                  disabled={!canChange}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-40"
                  title="Delete queued message"
                  aria-label="Delete queued message"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {!isSteering ? (
              <button
                type="button"
                onClick={() => onSteer(message.id)}
                disabled={isOptimistic || steeringMessageId === message.id || isMutating}
                className="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-[12px] font-medium text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-60"
              >
                {isOptimistic
                  ? "Queueing..."
                  : steeringMessageId === message.id
                    ? "Steering..."
                    : "Steer"}
              </button>
            ) : (
              <span className="shrink-0 text-[11px] text-emerald-300">Steering</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
