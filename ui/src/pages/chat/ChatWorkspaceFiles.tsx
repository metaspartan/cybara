import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  FileCode2,
  Loader2,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { FileTree } from "@/pages/ide/FileTree";
import { LSPStatus } from "@/pages/ide/LSPStatus";
import type { Diagnostic, FileEntry, ReadResult } from "@/pages/ide/ideTypes";
import { cn } from "@/lib/utils";

interface ChatWorkspaceFilesProps {
  initialPath?: string;
  workspaceDir: string | null;
  onOpenFullIde: (path: string) => void;
}

interface DiagnosticResponse {
  success: boolean;
  diagnostics?: Diagnostic[];
  error?: string;
}

function fileExtension(path: string | null): string | null {
  if (!path) return null;
  const name = path.split(/[\\/]/).pop() || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

export function ChatWorkspaceFiles({
  initialPath,
  workspaceDir,
  onOpenFullIde,
}: ChatWorkspaceFilesProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState("");
  const [content, setContent] = useState("");
  const [filter, setFilter] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const loadRequestRef = useRef(0);
  const selectedPathRef = useRef<string | null>(null);
  const modified = content !== savedContent;
  const extension = useMemo(() => fileExtension(selectedPath), [selectedPath]);

  const loadDiagnostics = useCallback(async (path: string): Promise<Diagnostic[]> => {
    try {
      const response = await apiFetch(`/api/lsp/diagnostics/file?path=${encodeURIComponent(path)}`);
      const data = (await response.json()) as DiagnosticResponse;
      return response.ok && data.success && Array.isArray(data.diagnostics) ? data.diagnostics : [];
    } catch {
      return [];
    }
  }, []);

  const loadFile = useCallback(
    async (path: string) => {
      const normalizedPath = path.trim();
      if (!normalizedPath) return;
      const requestId = loadRequestRef.current + 1;
      loadRequestRef.current = requestId;
      selectedPathRef.current = normalizedPath;
      setSelectedPath(normalizedPath);
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/api/ide/read?path=${encodeURIComponent(normalizedPath)}`);
        const data = (await response.json()) as ReadResult;
        if (!response.ok || !data.success) throw new Error(data.error || "Failed to read file");
        if (loadRequestRef.current !== requestId) return;
        const nextBinary = data.isBinary === true;
        const nextContent = nextBinary ? "" : (data.content ?? "");
        setBinary(nextBinary);
        setSavedContent(nextContent);
        setContent(nextContent);
        const nextDiagnostics = await loadDiagnostics(normalizedPath);
        if (loadRequestRef.current === requestId) setDiagnostics(nextDiagnostics);
      } catch (reason) {
        if (loadRequestRef.current !== requestId) return;
        setBinary(false);
        setSavedContent("");
        setContent("");
        setDiagnostics([]);
        setError(reason instanceof Error ? reason.message : "Failed to read file");
      } finally {
        if (loadRequestRef.current === requestId) setLoading(false);
      }
    },
    [loadDiagnostics]
  );

  useEffect(() => {
    if (initialPath && initialPath !== selectedPath) void loadFile(initialPath);
  }, [initialPath, loadFile, selectedPath]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectFile = useCallback(
    (entry: FileEntry) => {
      if (entry.type === "file") void loadFile(entry.path);
    },
    [loadFile]
  );

  const saveFile = useCallback(async () => {
    if (!selectedPath || binary || !modified || saving) return;
    const targetPath = selectedPath;
    const targetContent = content;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch("/api/ide/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath, content: targetContent }),
      });
      const data = (await response.json()) as {
        success: boolean;
        error?: string;
      };
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to save file");
      if (selectedPathRef.current === targetPath) setSavedContent(targetContent);
      setRefreshToken((value) => value + 1);
      window.setTimeout(() => {
        void loadDiagnostics(targetPath).then((nextDiagnostics) => {
          if (selectedPathRef.current === targetPath) setDiagnostics(nextDiagnostics);
        });
      }, 350);
    } catch (reason) {
      if (selectedPathRef.current === targetPath) {
        setError(reason instanceof Error ? reason.message : "Failed to save file");
      }
    } finally {
      setSaving(false);
    }
  }, [binary, content, loadDiagnostics, modified, saving, selectedPath]);

  if (!workspaceDir) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-xs text-[var(--text-muted)]">
        Select a workspace to browse and edit files.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(160px,36%)_minmax(0,1fr)] bg-[var(--surface-panel)]">
      <div className="flex min-h-0 flex-col border-r border-[var(--surface-border)]">
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--surface-border)] px-2">
          <Search className="h-3.5 w-3.5 text-[var(--text-subtle)]" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--context-tooltip-body)] outline-none placeholder:text-[var(--text-subtle)]"
            placeholder="Filter files"
          />
          <button
            type="button"
            onClick={() => setRefreshToken((value) => value + 1)}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--context-tooltip-body)]"
            title="Refresh files"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          <FileTree
            path={workspaceDir}
            selectedPath={selectedPath}
            onSelectFile={selectFile}
            expandedDirs={expandedDirs}
            onToggleDir={toggleDir}
            filterQuery={filter}
            refreshToken={refreshToken}
          />
        </div>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-col bg-[var(--surface-raised)]">
        {selectedPath ? (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--surface-border)] px-3 text-[11px] text-[var(--text-muted)]">
              <FileCode2 className="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 truncate" title={selectedPath}>
                {selectedPath.split(/[\\/]/).pop()}
                {modified ? " •" : ""}
              </span>
              <button
                type="button"
                onClick={() => void saveFile()}
                disabled={!modified || saving || binary}
                className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--context-tooltip-body)] disabled:opacity-35"
                title="Save file"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenFullIde(selectedPath)}
                className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--context-tooltip-body)]"
                title="Open in full IDE"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="relative min-h-0 flex-1">
              {loading ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--surface-raised)]/80">
                  <Loader2 className="h-5 w-5 animate-spin text-[rgb(var(--accent-primary))]" />
                </div>
              ) : null}
              {binary ? (
                <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
                  Binary file preview is unavailable.
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                      event.preventDefault();
                      void saveFile();
                    }
                  }}
                  spellCheck={false}
                  aria-label="Workspace file editor"
                  className="h-full w-full resize-none bg-transparent p-3 font-mono text-[12px] leading-5 text-[var(--context-tooltip-body)] outline-none selection:bg-[rgba(var(--accent-primary),0.3)]"
                />
              )}
            </div>
            <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-t border-[var(--surface-border)] px-2">
              <LSPStatus compact activeFilePath={selectedPath} activeExtension={extension} />
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[10px]",
                  diagnostics.some((item) => item.severity === "error")
                    ? "text-red-300"
                    : diagnostics.length > 0
                      ? "text-amber-300"
                      : "text-[var(--text-subtle)]"
                )}
                title={diagnostics.map((item) => `${item.line + 1}: ${item.message}`).join("\n")}
              >
                {diagnostics.length > 0 ? (
                  <AlertCircle className="h-3 w-3" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                {diagnostics.length} problem
                {diagnostics.length === 1 ? "" : "s"}
              </span>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
            Select a file to edit
          </div>
        )}
        {error ? (
          <div className="absolute bottom-10 left-3 right-3 rounded-md bg-red-950/90 px-3 py-2 text-[11px] text-red-200 shadow-xl">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
