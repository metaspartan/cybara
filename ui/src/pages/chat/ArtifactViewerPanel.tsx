import { ArrowLeft, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactSummaryView } from "./chatModel";
import { MessageContent } from "./MessageContent";

export function ArtifactViewerPanel({
  artifact,
  loading,
  error,
  content,
  rawView,
  onBack,
  onToggleView,
}: {
  artifact: ArtifactSummaryView | null;
  loading: boolean;
  error: string | null;
  content: string;
  rawView: boolean;
  onBack: () => void;
  onToggleView: (raw: boolean) => void;
}) {
  const resolvedPath =
    artifact?.path ||
    (artifact ? `~/.cybara/artifacts/${artifact.sessionId}/${artifact.fileName}` : "");
  const locationLabel = artifact
    ? `/api/sessions/${encodeURIComponent(artifact.sessionId)}/artifacts/${encodeURIComponent(artifact.fileName)}`
    : "";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 sm:px-4 py-2 border-b border-white/10 bg-[#0a0a0f]/90 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[12px] text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to chat
          </button>
          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[12px] text-gray-300">
            <FileText className="w-3.5 h-3.5 text-indigo-300" />
            <span className="truncate max-w-[280px] sm:max-w-[520px]">
              {artifact?.title || artifact?.fileName || "Artifact"}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleView(false)}
              className={cn(
                "rounded-md border px-2 py-1 text-[12px] transition-colors cursor-pointer",
                !rawView
                  ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-200"
                  : "border-white/15 bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/[0.08]"
              )}
            >
              Markdown
            </button>
            <button
              type="button"
              onClick={() => onToggleView(true)}
              className={cn(
                "rounded-md border px-2 py-1 text-[12px] transition-colors cursor-pointer",
                rawView
                  ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-200"
                  : "border-white/15 bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/[0.08]"
              )}
            >
              Raw
            </button>
          </div>
        </div>
        {artifact && (
          <div className="mt-2 space-y-1 text-[12px] text-gray-500">
            <p className="truncate">Path: {resolvedPath}</p>
            <p className="truncate">Endpoint: {locationLabel}</p>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading artifact...
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        ) : rawView ? (
          <pre className="max-h-full overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[12px] text-gray-200 whitespace-pre-wrap">
            {content}
          </pre>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <MessageContent content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
