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

export function GitStatus({ path, compact = false }: { path: string; compact?: boolean }) {
  const [branch, setBranch] = useState<string | null>(null);
  const [modified, setModified] = useState(0);
  const [untracked, setUntracked] = useState(0);

  useEffect(() => {
    const fetchGit = async () => {
      try {
        const res = await apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (data.isRepo) {
          setBranch(data.branch || "HEAD");
          setModified(data.modified?.length || 0);
          setUntracked(data.untracked?.length || 0);
        } else {
          setBranch(null);
        }
      } catch {
        setBranch(null);
      }
    };
    fetchGit();
  }, [path]);

  if (!branch) return null;

  return (
    <div
      className={cn(
        compact
          ? "flex items-center gap-2 text-xs text-gray-500"
          : "px-3 py-2 border-t border-white/10 bg-white/5"
      )}
    >
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <GitBranch className="w-3 h-3" />
        <span className="text-indigo-400 font-medium">{branch}</span>
        {modified > 0 && <span className="text-yellow-400">~{modified}</span>}
        {untracked > 0 && <span className="text-gray-400">+{untracked}</span>}
      </div>
    </div>
  );
}


