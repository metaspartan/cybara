import { memo, useEffect, useMemo, useState } from "react";
import type React from "react";
import { AlertCircle, ChevronDown, ChevronRight, Folder, FolderOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";
import { formatSize, getFileIcon } from "./ideUtils";
import type { BrowseResult, FileEntry } from "./ideTypes";
import {
  EXPLORER_VIRTUALIZATION_MIN_ENTRIES,
  EXPLORER_VIRTUALIZATION_OVERSCAN,
  EXPLORER_VIRTUALIZATION_ROW_HEIGHT,
} from "./ideConstants";
const FileTreeItem = memo(function FileTreeItem({
  entry,
  level = 0,
  isExpanded,
  onToggle,
  onSelect,
  onContextMenu,
  isSelected,
}: {
  entry: FileEntry;
  level?: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  onSelect: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, event: React.MouseEvent<HTMLDivElement>) => void;
  isSelected: boolean;
}) {
  const isDir = entry.type === "directory";
  const isModified = entry.gitModified || entry.gitStaged;
  const isIgnored = entry.gitIgnored;
  const isUntracked = entry.gitUntracked;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md transition-colors text-sm select-none",
        "!outline-none focus:!outline-none",
        isSelected
          ? "bg-indigo-500/20 text-indigo-300"
          : isIgnored
            ? "text-gray-600 hover:bg-white/5 hover:text-gray-300"
            : isModified
              ? "text-amber-300 hover:bg-white/5 hover:text-amber-200"
              : "text-gray-400 hover:bg-white/5 hover:text-white"
      )}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      onClick={() => {
        if (isDir && onToggle) {
          onToggle();
        } else {
          onSelect(entry);
        }
      }}
      onMouseDown={(event) => {
        if (event.button === 2) {
          event.preventDefault();
        }
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(entry, event);
      }}
    >
      {isDir ? (
        <>
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />
          )}
        </>
      ) : (
        <>
          <span className="w-3" />
          {getFileIcon(entry)}
        </>
      )}
      <span className={cn("truncate", isIgnored && !isSelected && "opacity-75")}>{entry.name}</span>
      {!isDir && (
        <div className="ml-auto flex items-center gap-1.5">
          {isModified && (
            <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              M
            </span>
          )}
          {!isModified && isUntracked && (
            <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              U
            </span>
          )}
          {entry.size !== undefined && (
            <span className="text-xs text-gray-600">{formatSize(entry.size)}</span>
          )}
        </div>
      )}
    </div>
  );
});

export const treeBrowseCache = new Map<string, FileEntry[]>();

interface FileTreeProps {
  path: string;
  level?: number;
  selectedPath: string | null;
  onSelectFile: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, event: React.MouseEvent<HTMLDivElement>) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  filterQuery: string;
  refreshToken: number;
  rootScrollTop?: number;
  rootViewportHeight?: number;
}

export const FileTree = memo(function FileTree({
  path,
  level = 0,
  selectedPath,
  onSelectFile,
  onContextMenu,
  expandedDirs,
  onToggleDir,
  filterQuery,
  refreshToken,
  rootScrollTop = 0,
  rootViewportHeight = 0,
}: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const fetchEntries = async () => {
      const cacheKey = `${refreshToken}:${path}`;
      const cachedEntries = treeBrowseCache.get(cacheKey);
      if (cachedEntries) {
        setEntries(cachedEntries);
        setError(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/ide/browse?path=${encodeURIComponent(path)}`);
        const data: BrowseResult = await res.json();
        if (isCancelled) return;
        if (data.success) {
          const nextEntries = Array.isArray(data.entries) ? data.entries : [];
          treeBrowseCache.set(cacheKey, nextEntries);
          setEntries(nextEntries);
        } else {
          setError(data.error || "Failed to load");
        }
      } catch (e) {
        if (isCancelled) return;
        setError(String(e));
      }
      if (isCancelled) return;
      setIsLoading(false);
    };
    fetchEntries();
    return () => {
      isCancelled = true;
    };
  }, [path, refreshToken]);

  const normalizedFilter = filterQuery.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedFilter) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(normalizedFilter));
  }, [entries, normalizedFilter]);

  // Fixed-row-height virtualization is only correct when the visible list is
  // flat: expanded directories render their children NESTED inside the parent
  // row, adding height the spacer math (visibleStart * rowHeight) can't account
  // for, which misaligns/duplicates rows. So only virtualize a flat root list
  // (the common large-directory perf case); once anything is expanded, render
  // every entry so heights stay correct.
  const hasExpandedDirectoriesAtLevel = useMemo(
    () =>
      filteredEntries.some((entry) => entry.type === "directory" && expandedDirs.has(entry.path)),
    [expandedDirs, filteredEntries]
  );
  const enableVirtualizedRows =
    level === 0 &&
    filteredEntries.length >= EXPLORER_VIRTUALIZATION_MIN_ENTRIES &&
    rootViewportHeight > 0 &&
    !hasExpandedDirectoriesAtLevel;
  const virtualWindow = useMemo(() => {
    if (!enableVirtualizedRows) {
      return {
        startIndex: 0,
        endIndex: filteredEntries.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }
    const rowHeight = EXPLORER_VIRTUALIZATION_ROW_HEIGHT;
    const visibleStart = Math.max(
      0,
      Math.floor(rootScrollTop / rowHeight) - EXPLORER_VIRTUALIZATION_OVERSCAN
    );
    const visibleEnd = Math.min(
      filteredEntries.length,
      Math.ceil((rootScrollTop + rootViewportHeight) / rowHeight) + EXPLORER_VIRTUALIZATION_OVERSCAN
    );
    return {
      startIndex: visibleStart,
      endIndex: visibleEnd,
      topSpacerHeight: visibleStart * rowHeight,
      bottomSpacerHeight: Math.max(0, (filteredEntries.length - visibleEnd) * rowHeight),
    };
  }, [enableVirtualizedRows, filteredEntries.length, rootScrollTop, rootViewportHeight]);
  const entriesToRender = enableVirtualizedRows
    ? filteredEntries.slice(virtualWindow.startIndex, virtualWindow.endIndex)
    : filteredEntries;

  if (isLoading && level === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </div>
    );
  }

  if (error && level === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-red-400 text-sm">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  if (level === 0 && filteredEntries.length === 0) {
    return (
      <div className="px-3 py-6 text-sm text-gray-500">
        {normalizedFilter
          ? `No files match "${filterQuery.trim()}"`
          : "No files found in this folder"}
      </div>
    );
  }

  return (
    <div>
      {enableVirtualizedRows && virtualWindow.topSpacerHeight > 0 && (
        <div style={{ height: `${virtualWindow.topSpacerHeight}px` }} aria-hidden />
      )}
      {entriesToRender.map((entry) => {
        const isDir = entry.type === "directory";
        const isExpanded = expandedDirs.has(entry.path);

        return (
          <div key={entry.path}>
            <FileTreeItem
              entry={entry}
              level={level}
              isExpanded={isExpanded}
              onToggle={() => onToggleDir(entry.path)}
              onSelect={onSelectFile}
              onContextMenu={onContextMenu}
              isSelected={selectedPath === entry.path}
            />
            {isDir && isExpanded && (
              <FileTree
                path={entry.path}
                level={level + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                filterQuery={filterQuery}
                refreshToken={refreshToken}
                rootScrollTop={rootScrollTop}
                rootViewportHeight={rootViewportHeight}
              />
            )}
          </div>
        );
      })}
      {enableVirtualizedRows && virtualWindow.bottomSpacerHeight > 0 && (
        <div style={{ height: `${virtualWindow.bottomSpacerHeight}px` }} aria-hidden />
      )}
    </div>
  );
});
