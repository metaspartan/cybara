import { Loader2, MessageSquare, Square, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface IDEChatHeaderProps {
  agentLabel: string;
  collapseProgressUpdates: boolean;
  isStopping: boolean;
  sessionId: string | null;
  showWorking: boolean;
  title: string;
  onClose: () => void;
  onNewChat: () => void;
  onStop: () => void;
  onToggleProgressUpdates: () => void;
}

export function IDEChatHeader({
  agentLabel,
  collapseProgressUpdates,
  isStopping,
  sessionId,
  showWorking,
  title,
  onClose,
  onNewChat,
  onStop,
  onToggleProgressUpdates,
}: IDEChatHeaderProps): React.ReactElement {
  return (
    <div className="px-3 py-2 max-md:pr-16 border-b border-[var(--surface-border)] flex items-start justify-between gap-3">
      <div className="min-w-0 flex items-start gap-2 text-xs text-[var(--text-secondary)]">
        <div className="mt-0.5 rounded-md border border-[var(--surface-border)] bg-[var(--surface-raised)] p-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-[var(--text-primary)]">{title}</span>
            {showWorking ? (
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
                Working
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
            <span>{agentLabel}</span>
            {sessionId ? (
              <span className="font-mono text-gray-600">{sessionId.slice(0, 8)}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {showWorking ? (
          <button
            type="button"
            onClick={onStop}
            disabled={isStopping}
            className="inline-flex h-7 items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 text-[11px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            title="Stop active run"
          >
            {isStopping ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            Stop
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleProgressUpdates}
          className="h-7 px-2 rounded text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5"
          title={collapseProgressUpdates ? "Expand progress updates" : "Collapse progress updates"}
        >
          {collapseProgressUpdates ? "Expand all" : "Collapse all"}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewChat}
          className="h-7 px-2 text-[11px]"
          title="Start new IDE chat session"
        >
          New
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-white/5"
          title="Close IDE chat"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
