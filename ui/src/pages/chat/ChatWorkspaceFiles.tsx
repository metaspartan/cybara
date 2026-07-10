import { useCallback, useState } from "react";
import { FileCode2, RefreshCw, Search } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { FileTree } from "@/pages/ide/FileTree";
import type { FileEntry, ReadResult } from "@/pages/ide/ideTypes";

export function ChatWorkspaceFiles({ workspaceDir }: { workspaceDir: string | null }) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [filter, setFilter] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectFile = useCallback(async (entry: FileEntry) => {
    if (entry.type !== "file") return;
    setSelectedPath(entry.path);
    try {
      const response = await apiFetch(`/api/ide/read?path=${encodeURIComponent(entry.path)}`);
      const data = (await response.json()) as ReadResult;
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to read file");
      setContent(data.isBinary ? "Binary file preview is unavailable." : (data.content ?? ""));
      setError(null);
    } catch (reason) {
      setContent("");
      setError(reason instanceof Error ? reason.message : "Failed to read file");
    }
  }, []);

  if (!workspaceDir) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-xs text-gray-500">
        Select a workspace to browse files.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(180px,42%)_1fr] bg-[#08090d]">
      <div className="flex min-h-0 flex-col border-r border-white/10">
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-white/10 px-2">
          <Search className="h-3.5 w-3.5 text-gray-600" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-gray-300 outline-none placeholder:text-gray-600"
            placeholder="Filter files"
          />
          <button
            type="button"
            onClick={() => setRefreshToken((value) => value + 1)}
            className="p-1 text-gray-600 hover:text-gray-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          <FileTree
            path={workspaceDir}
            selectedPath={selectedPath}
            onSelectFile={(entry) => void selectFile(entry)}
            expandedDirs={expandedDirs}
            onToggleDir={toggleDir}
            filterQuery={filter}
            refreshToken={refreshToken}
          />
        </div>
      </div>
      <div className="min-h-0 overflow-auto bg-[#0d0e12]">
        {selectedPath ? (
          <>
            <div className="sticky top-0 flex h-9 items-center gap-2 border-b border-white/10 bg-[#0d0e12] px-3 text-[11px] text-gray-400">
              <FileCode2 className="h-3.5 w-3.5" />
              <span className="truncate" title={selectedPath}>
                {selectedPath.split(/[\\/]/).pop()}
              </span>
            </div>
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-gray-300">
              {content}
            </pre>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-600">
            Select a file to preview
          </div>
        )}
        {error ? (
          <div className="m-3 rounded-md bg-red-950/60 px-3 py-2 text-[11px] text-red-200">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
