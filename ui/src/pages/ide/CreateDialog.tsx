import React, { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes } from "prism-react-renderer";
import {
  Loader2, Check, AlertTriangle, AlertCircle, Info, RotateCcw, X, ChevronRight, ChevronDown,
  ChevronUp, File, FileCode, FileJson, FileText, FilePlus, Folder, FolderOpen, Search, Save,
  RefreshCw, Copy, Code, Zap, Sparkles, MessageSquare, Square, ListTree, GitBranch,
  ExternalLink, CheckCircle2,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";
import { chatApi, agentsApi } from "@/lib/api";
import { useStopAgent } from "@/hooks/useApi";
import {
  mergeActivityLists, normalizeActivityTextForPhase, finalizeCompletedActivities,
  buildActivitiesFromToolCalls, type LiveActivityItem, type ToolCallLike,
} from "@/lib/chatActivities";
import { connectStatusStream } from "@/lib/status-stream";
import {
  parseGitDiffDecorations, countGitDiffLineChanges, mergeGitDiffDecorations,
  buildPendingInlinePreviewRows, emptyIdePendingDiffDecorations,
  type IdePendingLineState, type IdePendingDeletedBlock,
  type IdePendingInlinePreviewRow, type IdePendingDiffDecorations,
} from "@/lib/idePendingDiffDecorations";
import {
  IDE_DEFAULT_PREFERENCES, IDE_CHAT_AGENT_STORAGE_KEY, IDE_CHAT_OPEN_STORAGE_KEY,
  IDE_CHAT_WIDTH_STORAGE_KEY, EDITOR_FONT_SIZE_PX, EDITOR_LINE_HEIGHT_PX,
  EDITOR_LARGE_FILE_CHAR_THRESHOLD, EDITOR_LARGE_FILE_LINE_THRESHOLD,
  COMPLETION_LOCAL_SCAN_BEFORE, COMPLETION_LOCAL_SCAN_AFTER, COMPLETION_CACHE_TTL_MS, COMPLETION_CACHE_MAX_ENTRIES,
  EDITOR_TYPING_BURST_MS,
} from "./ideConstants";
import { getActiveLanguageFromExtension } from "./ideLanguageMaps";
import {
  getFileIcon, formatSize, getLineAndColumn, getPrismLanguage, splitPathForBreadcrumbs,
  flattenOutlineSymbols, getSymbolKindLabel, fileEntryFromPath, isMarkdownExtension,
  ideMarkdownComponents, formatBlameStamp, formatBlameDateTime, scoreQuickOpenResult, getSeverityIcon,
} from "./ideUtils";
import {
  isPlainRecord, normalizeIdePath, getIdePendingFileDecisionKey, isSameIdePath, countDiffLines,
  truncateDiffPreview, shouldHydratePendingFileDiffFromGit, getPendingLineTextClass,
  getPendingLineContainerClass, getPendingLineDecorationStyle, summarizePendingDeletedBlocks,
  parseIdePatchFileChanges, parseIdeChangeRecord, summarizeIdeFileChanges,
  summarizeIdeTextFileChanges, summarizeIdeMessageFileChanges, summarizeIdeActivityFileChanges,
  mergeIdeFileChangeSummaries, reverseUnifiedDiff, isIdeToolCallLike, getIdeToolCallsInTimelineOrder,
} from "./ideDiffHelpers";
import {
  getIdeToolCallArgs, getIdeToolCallCommand, getIdeToolCallResultSummary, getIdeToolCallExitCode,
  parseIdeTimestampMs, normalizeIdeSandboxProviderValue, formatIdeSandboxProviderLabel,
  isGenericIdeStatusLabel, isMeaningfulIdeThoughtDetail, getLatestIdeInFlightStep,
  toIdeLiveActivityItems, formatIdeStatusEventText, getIdeHeaderTitle,
} from "./ideActivityHelpers";
import {
  persistIdeChatAgentId, readPersistedChatOpen, persistChatOpen, readPersistedChatWidth,
  persistChatWidth, readPersistedIdeChatAgentId, readPersistedIdePreferences,
} from "./idePersistence";
import type {
  FileEntry, BrowseResult, ReadResult, Diagnostic, LspActiveServer,
  IdeSearchMatch, IdeSearchFileResult, IdeSearchResult, IdeReplaceResult,
  IdeReplacePreviewFile, IdeReplacePreviewResult, IdeListFilesResult, WorkspaceIndexerSettings,
  IdeBlameLine, IdeBlameResult, GitHistoryStatus, IdeTab, IdeChatMessage, IdeChatAgentOption,
  IdeProcessActivity, IdeFileChangeItem, IdeFileChangeSummary, IdePendingFileDiff,
  IdePendingFileDiffController, TreeContextMenuState, IdeCommandItem, IdeOutlineSymbol,
  IdeOutlineResponse, IdeCompletionItem, IdeCompletionResponse, IdeInlineCompletionResponse,
  FlattenedOutlineSymbol, IdeBreadcrumb, IdeSettingsSectionId, IdeTopMenuId, IdePreferences,
} from "./ideTypes";
import { IdeActivityText, IdeProcessActivityList, IdeLiveActivityTimeline } from "./IdeActivityTimeline";

export function CreateDialog({
  isOpen,
  type,
  parentPath,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  type: "file" | "directory";
  parentPath: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;

    setIsCreating(true);
    setError(null);
    try {
      const res = await apiFetch("/api/ide/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath, name: name.trim(), type }),
      });
      const data = await res.json();
      if (data.success) {
        setName("");
        onSuccess();
        onClose();
      } else {
        setError(data.error || "Failed to create");
      }
    } catch (e) {
      setError(String(e));
    }
    setIsCreating(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-card rounded-xl p-6 w-96">
        <h3 className="text-lg font-semibold text-white mb-4">
          New {type === "file" ? "File" : "Folder"}
        </h3>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "file" ? "filename.ts" : "folder-name"}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm mb-4 !outline-none focus:border-indigo-500/50"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreate} disabled={isCreating || !name.trim()}>
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span className="ml-1">Create</span>
          </Button>
        </div>
      </div>
    </div>
  );
}


