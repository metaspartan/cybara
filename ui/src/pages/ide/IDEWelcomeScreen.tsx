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

export function IDEWelcomeScreen({
  workspacePath,
  onNewFile,
  onOpenWorkspace,
  onOpenCommandPalette,
  onOpenSettings,
  onOpenAiSettings,
  onOpenIndexerSettings,
}: {
  workspacePath: string;
  onNewFile: () => void;
  onOpenWorkspace: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  onOpenAiSettings: () => void;
  onOpenIndexerSettings: () => void;
}) {
  const normalizedWorkspace = workspacePath
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^C:\\Users\\[^\\]+/, "~");

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[#070811]">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-8 py-14">
        <div className="mb-9">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-100">
            Welcome to Cybara IDE
          </h1>
          <p className="mt-1 text-sm text-gray-500">Current workspace: {normalizedWorkspace}</p>
        </div>

        <div className="mb-8">
          <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-gray-600">
            Get Started
          </div>
          <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-black/20">
            <button
              type="button"
              onClick={onNewFile}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <FilePlus className="h-4 w-4 text-indigo-300" />
                New File
              </span>
              <span className="text-xs text-gray-500">Ctrl/Cmd+N</span>
            </button>
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-amber-300" />
                Open Workspace
              </span>
              <span className="text-xs text-gray-500">Folder Path</span>
            </button>
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <ListTree className="h-4 w-4 text-indigo-300" />
                Open Command Palette
              </span>
              <span className="text-xs text-gray-500">Ctrl/Cmd+Shift+P</span>
            </button>
          </div>
        </div>

        <div className="mb-8">
          <div className="mb-3 text-[11px] uppercase tracking-[0.12em] text-gray-600">
            Configure
          </div>
          <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-black/20">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span>Open Settings</span>
              <span className="text-xs text-gray-500">/settings</span>
            </button>
            <button
              type="button"
              onClick={onOpenAiSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
            >
              <span>Open AI Provider Settings</span>
              <span className="text-xs text-gray-500">/providers</span>
            </button>
            <button
              type="button"
              onClick={onOpenIndexerSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-300 hover:bg-white/5"
            >
              <span>Open Indexer Settings</span>
              <span className="text-xs text-gray-500">Workspace Indexer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

