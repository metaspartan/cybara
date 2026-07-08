import { Loader2, Send, Square } from "lucide-react";

interface ChatComposerActionButtonProps {
  disabled: boolean;
  isStopping: boolean;
  queueing: boolean;
  showStop: boolean;
  onSend: () => void;
  onStop: () => void;
}

export function ChatComposerActionButton({
  disabled,
  isStopping,
  queueing,
  showStop,
  onSend,
  onStop,
}: ChatComposerActionButtonProps) {
  if (showStop) {
    return (
      <button
        type="button"
        onClick={onStop}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/35 bg-red-500/15 text-red-300 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        disabled={isStopping}
        title="Stop active run"
      >
        {isStopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <button
      onClick={onSend}
      disabled={disabled}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full accent-button disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      title={queueing ? "Queue follow-up" : "Send message"}
    >
      <Send className="w-3.5 h-3.5" />
    </button>
  );
}
