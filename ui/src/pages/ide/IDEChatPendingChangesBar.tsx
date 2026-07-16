import { Check, Loader2, RotateCcw } from "lucide-react";

interface IDEChatPendingChangesBarProps {
  fileCount: number;
  totalAdded: number;
  totalRemoved: number;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}

export function IDEChatPendingChangesBar({
  fileCount,
  totalAdded,
  totalRemoved,
  busy,
  onAccept,
  onReject,
}: IDEChatPendingChangesBarProps) {
  return (
    <div className="px-3 py-2 border-t border-indigo-500/20 bg-[#121423] flex items-center justify-between gap-2">
      <div className="text-[11px] text-gray-200 min-w-0 truncate">
        {fileCount} file{fileCount === 1 ? "" : "s"} with changes{" "}
        <span className="text-emerald-300">+{totalAdded}</span>{" "}
        <span className="text-red-300">-{totalRemoved}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="inline-flex items-center rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
          title="Reject all pending file changes"
        >
          {busy ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <RotateCcw className="w-3 h-3 mr-1" />
          )}
          Reject all
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
          title="Accept all pending file changes"
        >
          <Check className="w-3 h-3 mr-1" />
          Accept all
        </button>
      </div>
    </div>
  );
}
