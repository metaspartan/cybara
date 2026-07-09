import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Folder, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button, Input, Modal } from "@/components/ui";
import type { BrowseResult, FileEntry } from "@/pages/ide/ideTypes";

function parentPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "~" || trimmed === "/" || /^[A-Za-z]:[\\/]?$/.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replace(/[\\/]+$/, "");
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (slash <= 0) return "/";
  return normalized.slice(0, slash);
}

function directoryEntries(entries: FileEntry[]): FileEntry[] {
  return entries
    .filter((entry) => entry.type === "directory")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function LocalFolderPickerModal({
  defaultPath,
  description,
  isOpen,
  onClose,
  onSelect,
  title = "Choose Folder",
}: {
  defaultPath?: string | null;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void | Promise<void>;
  title?: string;
}) {
  const initialPath = defaultPath?.trim() || "~";
  const [path, setPath] = useState(initialPath);
  const [draftPath, setDraftPath] = useState(initialPath);
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const folders = useMemo(() => directoryEntries(result?.entries ?? []), [result]);
  const canGoUp = !!parentPath(path);

  useEffect(() => {
    if (!isOpen) return;
    const nextPath = defaultPath?.trim() || "~";
    setPath(nextPath);
    setDraftPath(nextPath);
  }, [defaultPath, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(path)}`);
        const data = (await response.json()) as BrowseResult;
        if (cancelled) return;
        if (!response.ok || data.success === false) {
          setResult(data);
          setError(data.error || "Unable to browse this folder.");
          return;
        }
        setResult(data);
        setDraftPath(data.path || path);
      } catch (err) {
        if (!cancelled) {
          setResult(null);
          setError(err instanceof Error ? err.message : "Unable to browse this folder.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, path, refreshKey]);

  async function selectCurrentPath() {
    const selected = (result?.path || draftPath || path).trim();
    if (!selected) return;
    setSelecting(true);
    try {
      await onSelect(selected);
      onClose();
    } finally {
      setSelecting(false);
    }
  }

  function submitDraftPath() {
    const nextPath = draftPath.trim();
    if (nextPath) setPath(nextPath);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} size="lg">
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Folder path"
            value={draftPath}
            onChange={(event) => setDraftPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitDraftPath();
              }
            }}
          />
          <Button variant="secondary" onClick={submitDraftPath} disabled={loading}>
            Go
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              const parent = parentPath(path);
              if (parent) setPath(parent);
            }}
            disabled={!canGoUp || loading}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Up
          </button>
          <div className="min-w-0 flex-1 truncate text-center font-mono text-xs text-gray-400">
            {result?.path || path}
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>

        <div className="max-h-[360px] min-h-[240px] overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
          {loading && !result ? (
            <div className="flex h-52 items-center justify-center text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading folders
            </div>
          ) : error ? (
            <div className="flex h-52 flex-col items-center justify-center px-8 text-center">
              <FolderOpen className="mb-3 h-7 w-7 text-gray-600" />
              <div className="text-sm font-medium text-gray-300">Folder unavailable</div>
              <div className="mt-1 text-xs text-gray-500">{error}</div>
            </div>
          ) : folders.length === 0 ? (
            <div className="flex h-52 flex-col items-center justify-center text-gray-500">
              <Folder className="mb-3 h-7 w-7 opacity-50" />
              <div className="text-sm">No subfolders here</div>
            </div>
          ) : (
            <div className="space-y-1">
              {folders.map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  onClick={() => setPath(folder.path)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Folder className="h-4 w-4 shrink-0 text-blue-300" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate font-mono text-xs text-gray-500">
            Selected: {result?.path || draftPath || path}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={selecting}>
              Cancel
            </Button>
            <Button onClick={() => void selectCurrentPath()} isLoading={selecting}>
              Use Folder
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
