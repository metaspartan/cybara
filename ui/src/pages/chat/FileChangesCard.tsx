import { useState } from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { DiffCodeBlock } from "./MessageContent";
import { formatFilePathForDisplay, type FileChangeSummary } from "./chatModel";

export function FileChangesCard({
  summary,
  workspaceDir,
}: {
  summary: FileChangeSummary;
  workspaceDir?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full px-3 py-2 flex items-center gap-2 text-[12px] cursor-pointer hover:bg-white/5 transition-colors"
      >
        <FileText className="w-3 h-3 text-indigo-300" />
        <span className="text-gray-200 font-medium">
          {summary.files.length} files changed
          <span className="ml-2 text-green-300">+{summary.totalAdded}</span>
          <span className="ml-1 text-red-300">-{summary.totalRemoved}</span>
        </span>
        <span className="flex-1" />
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-white/5 px-3 py-2 space-y-3">
          {summary.files.map((file) => {
            const pathDisplay = formatFilePathForDisplay(file.path, workspaceDir);
            return (
              <div
                key={`${file.path}-${file.type}`}
                className="rounded-md border border-white/10 bg-black/25"
                title={pathDisplay.fullPath}
              >
                <div className="flex items-center justify-between gap-3 px-2.5 py-2 text-[12px]">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-100">{pathDisplay.fileName}</p>
                    <p className="truncate text-[10px] text-gray-500">
                      {pathDisplay.parentPath || file.type}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-gray-500">
                      {file.type}
                    </span>
                    <span className="text-green-300">+{file.added}</span>
                    <span className="text-red-300">-{file.removed}</span>
                  </div>
                </div>
                {file.diff && <DiffCodeBlock code={file.diff} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
