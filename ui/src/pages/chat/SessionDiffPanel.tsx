import { FileText, FolderOpen, Loader2, RotateCcw, X } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import {
  DIFF_PANEL_MIN_WIDTH,
  type FileChangeItem,
  type FileChangeSummary,
  formatFilePathForDisplay,
} from "./chatModel";
import { DiffCodeBlock } from "./MessageContent";

export function SessionDiffPanel({
  embedded = false,
  isOpen,
  summary,
  selectedPath,
  onSelectPath,
  onClose,
  width,
  onResizeStart,
  onOpenInIDE,
  workspaceDir,
  loading = false,
  error = null,
  onRetry,
}: {
  embedded?: boolean;
  isOpen: boolean;
  summary: FileChangeSummary | null;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onClose: () => void;
  width: number;
  onResizeStart: (event: MouseEvent<HTMLElement>) => void;
  onOpenInIDE: (file: FileChangeItem) => void;
  workspaceDir?: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (!isOpen) return null;

  const selectedFile =
    summary?.files.find((file) => file.path === selectedPath) || summary?.files[0] || null;

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden",
        embedded ? "h-full w-full" : "glass-strong border-l border-white/5"
      )}
      style={embedded ? undefined : { width: `${width}px`, minWidth: `${DIFF_PANEL_MIN_WIDTH}px` }}
    >
      {!embedded && (
        <button
          type="button"
          onMouseDown={onResizeStart}
          className="absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize z-20 group"
          title="Resize file diff panel"
          aria-label="Resize file diff panel"
        >
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10 transition-colors group-hover:bg-indigo-400/70" />
        </button>
      )}
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/5 bg-white/[0.02] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="w-3.5 h-3.5 shrink-0 text-indigo-300" />
          <h3 className="text-sm font-medium text-white">File Diffs</h3>
          {loading && (
            <Loader2
              className="h-3 w-3 shrink-0 animate-spin text-gray-500"
              aria-label="Loading complete diffs"
            />
          )}
          {summary && summary.files.length > 0 && (
            <span className="truncate text-[11px] text-gray-500">
              <span className="text-green-300">+{summary.totalAdded}</span>
              <span className="mx-0.5">/</span>
              <span className="text-red-300">-{summary.totalRemoved}</span>
              <span className="ml-1.5">
                {summary.files.length} file{summary.files.length === 1 ? "" : "s"}
              </span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {error && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg p-1.5 text-amber-300 transition-colors hover:bg-white/5 hover:text-amber-200"
              title={error}
              aria-label="Retry loading complete file diffs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {selectedFile && (
            <button
              type="button"
              onClick={() => onOpenInIDE(selectedFile)}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-indigo-300 transition-colors cursor-pointer"
              title="Open selected file in IDE"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          )}
          {!embedded && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
              title="Close file diff panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {!summary || summary.files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center text-gray-500">
          <div>
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No file diffs in this session yet</p>
          </div>
        </div>
      ) : (
        <>
          <div className="max-h-52 shrink-0 overflow-y-auto border-b border-white/5 py-1">
            {summary.files.map((file) => {
              const isSelected = selectedFile?.path === file.path;
              const pathDisplay = formatFilePathForDisplay(file.path, workspaceDir);
              return (
                <button
                  key={`${file.path}-${file.type}`}
                  type="button"
                  onClick={() => onSelectPath(file.path)}
                  title={pathDisplay.fullPath}
                  className={cn(
                    "grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer",
                    isSelected ? "bg-[rgba(var(--accent-primary),0.12)]" : "hover:bg-white/[0.045]"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      file.type === "created"
                        ? "bg-green-400"
                        : file.type === "deleted"
                          ? "bg-red-400"
                          : "bg-amber-300"
                    )}
                    title={file.type}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-gray-100">
                      {pathDisplay.fileName}
                    </span>
                    <span className="block truncate text-[10.5px] text-gray-500">
                      {pathDisplay.parentPath || file.type}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums">
                    <span className="text-green-300">+{file.added}</span>
                    <span className="ml-1 text-red-300">-{file.removed}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-2.5">
            {selectedFile ? (
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/20">
                <div className="flex items-center gap-2 border-b border-white/10 px-2.5 py-2">
                  {(() => {
                    const pathDisplay = formatFilePathForDisplay(selectedFile.path, workspaceDir);
                    return (
                      <div className="min-w-0 flex-1" title={pathDisplay.fullPath}>
                        <p className="truncate text-[12px] font-medium text-gray-100">
                          {pathDisplay.fileName}
                        </p>
                        <p className="truncate text-[10px] text-gray-500">
                          {pathDisplay.parentPath || pathDisplay.relativePath}
                        </p>
                      </div>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => onOpenInIDE(selectedFile)}
                    className="p-1 rounded-md text-gray-500 hover:text-indigo-300 hover:bg-white/5 transition-colors cursor-pointer"
                    title="Open selected file in IDE"
                    aria-label={`Open ${selectedFile.path} in IDE`}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
                {selectedFile.diff ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    <DiffCodeBlock code={selectedFile.diff} fill />
                  </div>
                ) : (
                  <div className="p-3 text-[12px] text-gray-500">
                    No line-by-line diff captured for this file change.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[12px] text-gray-500">Select a file to view its diff.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
