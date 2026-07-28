import {
  Check,
  Copy,
  CornerUpRight,
  FlaskConical,
  Loader2,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn, formatRelativeTime } from "@/lib/utils";

interface ChatMessageActionRowProps {
  compact?: boolean;
  content: string;
  copiedMessageIndex: number | null;
  forkingMessageIndex: number | null;
  goldenTurnsEnabled: boolean;
  messageIndex: number;
  role: "user" | "assistant" | "system";
  savingGoldenMessageIndex: number | null;
  sessionId: string | null;
  speakingMessageIndex: number | null;
  timestamp?: string;
  onCopyMessage: (index: number, content: string) => void;
  onForkSession: (index: number) => void;
  onReadAloud: (index: number, content: string) => void;
  onRevert?: (index: number) => void;
  onSaveGolden: (index: number) => void;
}

export function ChatMessageActionRow({
  compact = false,
  content,
  copiedMessageIndex,
  forkingMessageIndex,
  goldenTurnsEnabled,
  messageIndex,
  role,
  savingGoldenMessageIndex,
  sessionId,
  speakingMessageIndex,
  timestamp,
  onCopyMessage,
  onForkSession,
  onReadAloud,
  onRevert,
  onSaveGolden,
}: ChatMessageActionRowProps): ReactElement {
  return (
    <div
      className={cn(
        "mt-1.5 flex items-center gap-1.5",
        role === "user" ? "justify-end" : "justify-start"
      )}
    >
      {timestamp && (
        <span className="chat-meta-text text-[var(--text-muted)]">
          {formatRelativeTime(timestamp)}
        </span>
      )}
      <button
        type="button"
        onClick={() => onCopyMessage(messageIndex, content)}
        className="chat-message-action cursor-pointer rounded-md p-1"
        title="Copy message"
        aria-label="Copy message"
      >
        {copiedMessageIndex === messageIndex ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
      {!compact && role === "assistant" && content.trim() && (
        <button
          type="button"
          onClick={() => onReadAloud(messageIndex, content)}
          className="chat-message-action cursor-pointer rounded-md p-1"
          title={speakingMessageIndex === messageIndex ? "Stop reading aloud" : "Read aloud"}
          aria-label={speakingMessageIndex === messageIndex ? "Stop reading aloud" : "Read aloud"}
        >
          {speakingMessageIndex === messageIndex ? (
            <VolumeX className="h-3 w-3" />
          ) : (
            <Volume2 className="h-3 w-3" />
          )}
        </button>
      )}
      {!compact && sessionId && (
        <button
          type="button"
          onClick={() => onForkSession(messageIndex)}
          disabled={forkingMessageIndex !== null}
          className="chat-message-action cursor-pointer rounded-md p-1 disabled:opacity-50"
          title="Fork chat from this message"
          aria-label="Fork chat from this message"
        >
          {forkingMessageIndex === messageIndex ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CornerUpRight className="h-3 w-3" />
          )}
        </button>
      )}
      {!compact && role === "assistant" && sessionId && goldenTurnsEnabled && (
        <button
          type="button"
          onClick={() => onSaveGolden(messageIndex)}
          disabled={savingGoldenMessageIndex !== null}
          className="chat-message-action cursor-pointer rounded-md p-1 disabled:opacity-50"
          title="Save turn as golden test"
          aria-label="Save turn as golden test"
        >
          {savingGoldenMessageIndex === messageIndex ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <FlaskConical className="h-3 w-3" />
          )}
        </button>
      )}
      {!compact && role === "user" && sessionId && onRevert && (
        <button
          type="button"
          onClick={() => onRevert(messageIndex)}
          className="chat-message-action cursor-pointer rounded-md p-1"
          title="Revert to before this message"
          aria-label="Revert to before this message"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
