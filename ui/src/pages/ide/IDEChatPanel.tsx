import React, { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes } from "prism-react-renderer";
import {
  Loader2,
  Check,
  AlertTriangle,
  AlertCircle,
  Info,
  RotateCcw,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  File,
  FileCode,
  FileJson,
  FileText,
  FilePlus,
  Folder,
  FolderOpen,
  Search,
  Save,
  RefreshCw,
  Copy,
  Code,
  Zap,
  Sparkles,
  MessageSquare,
  Square,
  ListTree,
  GitBranch,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";
import { chatApi, agentsApi } from "@/lib/api";
import { useStopAgent } from "@/hooks/useApi";
import {
  mergeActivityLists,
  normalizeActivityTextForPhase,
  finalizeCompletedActivities,
  buildActivitiesFromToolCalls,
  type LiveActivityItem,
  type ToolCallLike,
} from "@/lib/chatActivities";
import { connectStatusStream } from "@/lib/status-stream";
import {
  parseGitDiffDecorations,
  countGitDiffLineChanges,
  mergeGitDiffDecorations,
  buildPendingInlinePreviewRows,
  emptyIdePendingDiffDecorations,
  type IdePendingLineState,
  type IdePendingDeletedBlock,
  type IdePendingInlinePreviewRow,
  type IdePendingDiffDecorations,
} from "@/lib/idePendingDiffDecorations";
import {
  IDE_DEFAULT_PREFERENCES,
  IDE_CHAT_AGENT_STORAGE_KEY,
  IDE_CHAT_OPEN_STORAGE_KEY,
  IDE_CHAT_WIDTH_STORAGE_KEY,
  EDITOR_FONT_SIZE_PX,
  EDITOR_LINE_HEIGHT_PX,
  EDITOR_LARGE_FILE_CHAR_THRESHOLD,
  EDITOR_LARGE_FILE_LINE_THRESHOLD,
  COMPLETION_LOCAL_SCAN_BEFORE,
  COMPLETION_LOCAL_SCAN_AFTER,
  COMPLETION_CACHE_TTL_MS,
  COMPLETION_CACHE_MAX_ENTRIES,
  EDITOR_TYPING_BURST_MS,
} from "./ideConstants";
import { getActiveLanguageFromExtension } from "./ideLanguageMaps";
import {
  getFileIcon,
  formatSize,
  getLineAndColumn,
  getPrismLanguage,
  splitPathForBreadcrumbs,
  flattenOutlineSymbols,
  getSymbolKindLabel,
  fileEntryFromPath,
  isMarkdownExtension,
  ideMarkdownComponents,
  formatBlameStamp,
  formatBlameDateTime,
  scoreQuickOpenResult,
  getSeverityIcon,
} from "./ideUtils";
import {
  isPlainRecord,
  normalizeIdePath,
  getIdePendingFileDecisionKey,
  isSameIdePath,
  countDiffLines,
  truncateDiffPreview,
  shouldHydratePendingFileDiffFromGit,
  getPendingLineTextClass,
  getPendingLineContainerClass,
  getPendingLineDecorationStyle,
  summarizePendingDeletedBlocks,
  parseIdePatchFileChanges,
  parseIdeChangeRecord,
  summarizeIdeFileChanges,
  summarizeIdeTextFileChanges,
  summarizeIdeMessageFileChanges,
  summarizeIdeActivityFileChanges,
  mergeIdeFileChangeSummaries,
  reverseUnifiedDiff,
  isIdeToolCallLike,
  getIdeToolCallsInTimelineOrder,
} from "./ideDiffHelpers";
import {
  getIdeToolCallArgs,
  getIdeToolCallCommand,
  getIdeToolCallResultSummary,
  getIdeToolCallExitCode,
  parseIdeTimestampMs,
  normalizeIdeSandboxProviderValue,
  formatIdeSandboxProviderLabel,
  isGenericIdeStatusLabel,
  isMeaningfulIdeThoughtDetail,
  getLatestIdeInFlightStep,
  toIdeLiveActivityItems,
  formatIdeStatusEventText,
  getIdeHeaderTitle,
} from "./ideActivityHelpers";
import {
  persistIdeChatAgentId,
  readPersistedChatOpen,
  persistChatOpen,
  readPersistedChatWidth,
  persistChatWidth,
  readPersistedIdeChatAgentId,
  readPersistedIdePreferences,
} from "./idePersistence";
import type {
  FileEntry,
  BrowseResult,
  ReadResult,
  Diagnostic,
  LspActiveServer,
  IdeSearchMatch,
  IdeSearchFileResult,
  IdeSearchResult,
  IdeReplaceResult,
  IdeReplacePreviewFile,
  IdeReplacePreviewResult,
  IdeListFilesResult,
  WorkspaceIndexerSettings,
  IdeBlameLine,
  IdeBlameResult,
  GitHistoryStatus,
  IdeTab,
  IdeChatMessage,
  IdeChatAgentOption,
  IdeProcessActivity,
  IdeFileChangeItem,
  IdeFileChangeSummary,
  IdePendingFileDiff,
  IdePendingFileDiffController,
  TreeContextMenuState,
  IdeCommandItem,
  IdeOutlineSymbol,
  IdeOutlineResponse,
  IdeCompletionItem,
  IdeCompletionResponse,
  IdeInlineCompletionResponse,
  FlattenedOutlineSymbol,
  IdeBreadcrumb,
  IdeSettingsSectionId,
  IdeTopMenuId,
  IdePreferences,
} from "./ideTypes";
import {
  IdeActivityText,
  IdeProcessActivityList,
  IdeLiveActivityTimeline,
} from "./IdeActivityTimeline";

export function IDEChatPanel({
  workspaceDir,
  contextPath,
  terminalContext,
  onWorkspaceMutated,
  onClose,
  selectedAgentId,
  onSelectedAgentIdChange,
  onPendingFileDiffsChange,
  onPendingFileDiffControllerChange,
}: {
  workspaceDir: string;
  contextPath: string | null;
  terminalContext?: { isOpen: boolean; sessionCount: number; activeSessionId: string | null };
  onWorkspaceMutated: () => void;
  onClose: () => void;
  selectedAgentId: string;
  onSelectedAgentIdChange: (agentId: string) => void;
  onPendingFileDiffsChange?: (diffs: IdePendingFileDiff[]) => void;
  onPendingFileDiffControllerChange?: (controller: IdePendingFileDiffController | null) => void;
}) {
  const stopAgent = useStopAgent();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IdeChatMessage[]>([]);
  const [agents, setAgents] = useState<IdeChatAgentOption[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [isApplyingDiffAction, setIsApplyingDiffAction] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"thinking" | "generating" | "idle">("idle");
  const [liveActivities, setLiveActivities] = useState<LiveActivityItem[]>([]);
  const [liveCurrentStep, setLiveCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileDiffDecision, setFileDiffDecision] = useState<Record<string, "accepted" | "rejected">>(
    {}
  );
  const [resolvedPendingDiffs, setResolvedPendingDiffs] = useState<Record<string, string>>({});
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [collapseProgressUpdates, setCollapseProgressUpdates] = useState(false);
  const [copiedToolCallKey, setCopiedToolCallKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const latestStatusTimestampBySessionRef = useRef<Record<string, number>>({});
  const liveRunBufferRef = useRef<LiveActivityItem[]>([]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [liveActivities.length, messages, isSending]);

  useEffect(() => {
    activeSessionRef.current = sessionId;
    sendingRef.current = isSending;
  }, [isSending, sessionId]);

  useEffect(() => {
    let isCancelled = false;
    const loadAgents = async () => {
      try {
        const response = await agentsApi.list();
        if (!response.success || !response.data || isCancelled) return;
        const options = (response.data || [])
          .map((agent) => ({
            id: typeof agent.id === "string" ? agent.id : "",
            name: typeof agent.name === "string" ? agent.name : "Agent",
            status: typeof agent.status === "string" ? agent.status : undefined,
          }))
          .filter((agent) => agent.id);
        setAgents(options);
        if (!selectedAgentId && options.length === 1) {
          onSelectedAgentIdChange(options[0]?.id || "");
        }
      } catch {
        // Keep chat usable with default agent fallback.
      }
    };
    void loadAgents();
    return () => {
      isCancelled = true;
    };
  }, [onSelectedAgentIdChange, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    if (agents.some((agent) => agent.id === selectedAgentId)) return;
    onSelectedAgentIdChange("");
  }, [agents, onSelectedAgentIdChange, selectedAgentId]);

  const getMessageKey = useCallback((message: IdeChatMessage, index: number): string => {
    return `${message.role}:${message.timestamp}:${index}`;
  }, []);

  const messageChangeSummaryByKey = useMemo(() => {
    const map = new Map<string, IdeFileChangeSummary>();
    messages.forEach((message, index) => {
      if (message.role !== "assistant") return;
      const toolSummary = summarizeIdeMessageFileChanges(message.tool_calls);
      const summary =
        toolSummary ||
        mergeIdeFileChangeSummaries(
          summarizeIdeActivityFileChanges(message.process_activities),
          summarizeIdeTextFileChanges(message.content)
        );
      if (!summary) return;
      map.set(getMessageKey(message, index), summary);
    });
    return map;
  }, [getMessageKey, messages]);

  const resolvedFileEntriesByMessageKey = useMemo(() => {
    const map = new Map<string, IdePendingFileDiff[]>();
    for (const [messageKey, summary] of messageChangeSummaryByKey.entries()) {
      map.set(
        messageKey,
        summary.files.map((file) => {
          const fileKey = getIdePendingFileDecisionKey(messageKey, file.path);
          return {
            key: fileKey,
            messageKey,
            path: file.path,
            type: file.type,
            added: file.added,
            removed: file.removed,
            diff:
              resolvedPendingDiffs[fileKey] ||
              (typeof file.diff === "string" ? file.diff : undefined),
          } satisfies IdePendingFileDiff;
        })
      );
    }
    return map;
  }, [messageChangeSummaryByKey, resolvedPendingDiffs]);

  const pendingFileDiffs = useMemo(() => {
    const items: IdePendingFileDiff[] = [];
    for (const files of resolvedFileEntriesByMessageKey.values()) {
      for (const file of files) {
        if (!fileDiffDecision[file.key]) {
          items.push(file);
        }
      }
    }
    return items;
  }, [fileDiffDecision, resolvedFileEntriesByMessageKey]);

  const pendingMessageChangeKeys = useMemo(() => {
    const keys: string[] = [];
    for (const [messageKey, files] of resolvedFileEntriesByMessageKey.entries()) {
      if (files.some((file) => !fileDiffDecision[file.key])) {
        keys.push(messageKey);
      }
    }
    return keys;
  }, [fileDiffDecision, resolvedFileEntriesByMessageKey]);

  const pendingChangeAggregate = useMemo(() => {
    const byPath = new Map<string, { added: number; removed: number }>();
    for (const file of pendingFileDiffs) {
      const existing = byPath.get(file.path) || { added: 0, removed: 0 };
      existing.added += file.added;
      existing.removed += file.removed;
      byPath.set(file.path, existing);
    }
    const files = Array.from(byPath.entries()).map(([path, values]) => ({
      path,
      ...values,
    }));
    return {
      fileCount: files.length,
      totalAdded: files.reduce((sum, file) => sum + file.added, 0),
      totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
    };
  }, [pendingFileDiffs]);

  const conversationTitle = useMemo(
    () => getIdeHeaderTitle(sessionTitle, messages),
    [messages, sessionTitle]
  );
  const conversationAgentLabel = useMemo(() => {
    const resolvedAgentId = activeAgentId || selectedAgentId;
    if (!resolvedAgentId) return "Default agent";
    const matchedAgent = agents.find((agent) => agent.id === resolvedAgentId);
    return matchedAgent?.name || resolvedAgentId;
  }, [activeAgentId, agents, selectedAgentId]);
  const showWorkingTimeline =
    isSending || liveStatus !== "idle" || liveActivities.length > 0 || !!liveCurrentStep;

  useEffect(() => {
    onPendingFileDiffsChange?.(pendingFileDiffs);
  }, [onPendingFileDiffsChange, pendingFileDiffs]);

  useEffect(() => {
    return () => {
      onPendingFileDiffsChange?.([]);
    };
  }, [onPendingFileDiffsChange]);

  useEffect(() => {
    const filesNeedingHydration = pendingFileDiffs.filter(
      (file) => !resolvedPendingDiffs[file.key] && shouldHydratePendingFileDiffFromGit(file)
    );
    if (filesNeedingHydration.length === 0) return;

    let isCancelled = false;
    const controller = new AbortController();

    const hydratePendingDiffs = async () => {
      for (const file of filesNeedingHydration) {
        try {
          const response = await apiFetch(`/api/git/diff?path=${encodeURIComponent(file.path)}`, {
            signal: controller.signal,
          });
          const payload = (await response.json()) as { success?: boolean; diff?: string };
          if (
            !response.ok ||
            !payload.success ||
            typeof payload.diff !== "string" ||
            !payload.diff.trim() ||
            payload.diff === "(No changes)" ||
            isCancelled
          ) {
            continue;
          }

          setResolvedPendingDiffs((previous) => {
            if (previous[file.key]) return previous;
            return { ...previous, [file.key]: payload.diff as string };
          });
        } catch (errorValue) {
          if ((errorValue as Error)?.name === "AbortError") {
            return;
          }
        }
      }
    };

    void hydratePendingDiffs();
    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [pendingFileDiffs, resolvedPendingDiffs]);

  const mapApiMessageToIde = useCallback((value: unknown): IdeChatMessage | null => {
    if (!isPlainRecord(value)) return null;
    const role = value.role === "assistant" || value.role === "user" ? value.role : null;
    const content = typeof value.content === "string" ? value.content : "";
    const timestamp =
      typeof value.timestamp === "string" && value.timestamp
        ? value.timestamp
        : new Date().toISOString();
    if (!role || !content.trim()) return null;

    const toolCalls = Array.isArray(value.tool_calls)
      ? value.tool_calls.filter((entry): entry is ToolCallLike => isIdeToolCallLike(entry))
      : undefined;
    const processActivities = Array.isArray(
      (value as { process_activities?: unknown }).process_activities
    )
      ? ((value as { process_activities?: unknown[] }).process_activities || [])
          .map((entry): IdeProcessActivity | null => {
            if (!isPlainRecord(entry)) return null;
            const phase =
              entry.phase === "start" || entry.phase === "result" || entry.phase === "error"
                ? entry.phase
                : "result";
            const text = typeof entry.text === "string" ? entry.text.trim() : "";
            const timestampRaw =
              typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
                ? entry.timestamp
                : Date.now();
            if (!text) return null;
            return {
              id:
                typeof entry.id === "string" && entry.id.trim()
                  ? entry.id
                  : `${timestampRaw}-${Math.random().toString(36).slice(2, 8)}`,
              phase,
              text,
              timestamp: timestampRaw,
              toolName: typeof entry.toolName === "string" ? entry.toolName : undefined,
              toolCallId: typeof entry.toolCallId === "string" ? entry.toolCallId : undefined,
              sandboxProvider: normalizeIdeSandboxProviderValue(entry.sandboxProvider),
            };
          })
          .filter((entry): entry is IdeProcessActivity => entry !== null)
      : undefined;

    return {
      role,
      content,
      timestamp,
      thinking: typeof value.thinking === "string" ? value.thinking : undefined,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      process_activities:
        processActivities && processActivities.length > 0 ? processActivities : undefined,
    };
  }, []);

  const clearLiveRunState = useCallback(() => {
    setLiveStatus("idle");
    setLiveCurrentStep(null);
    setLiveActivities([]);
    liveRunBufferRef.current = [];
  }, []);

  const appendLiveActivity = useCallback(
    (
      phase: "start" | "result" | "error",
      text: string,
      toolName?: string,
      eventTimestamp?: number,
      toolCallId?: string,
      sandboxProvider?: string
    ) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const normalizedText = normalizeActivityTextForPhase(trimmed, phase);
      if (isGenericIdeStatusLabel(normalizedText)) return;
      const nextTimestamp =
        typeof eventTimestamp === "number" && Number.isFinite(eventTimestamp)
          ? eventTimestamp
          : Date.now();
      const normalizedToolName = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
      const normalizedToolCallId =
        typeof toolCallId === "string" && toolCallId.trim() ? toolCallId.trim().toLowerCase() : "";
      const normalizedSandboxProvider = normalizeIdeSandboxProviderValue(sandboxProvider);

      const sortAndMergeActivities = (items: LiveActivityItem[]): LiveActivityItem[] =>
        mergeActivityLists(
          [],
          [...items].sort((left, right) =>
            left.timestamp === right.timestamp
              ? left.id.localeCompare(right.id)
              : left.timestamp - right.timestamp
          )
        );

      const applyActivityEvent = (previous: LiveActivityItem[]): LiveActivityItem[] => {
        if (phase !== "start") {
          if (normalizedToolCallId) {
            for (let index = previous.length - 1; index >= 0; index -= 1) {
              const candidate = previous[index];
              if (candidate.phase !== "start") continue;
              if ((candidate.toolCallId || "").trim().toLowerCase() !== normalizedToolCallId) {
                continue;
              }
              if (nextTimestamp - candidate.timestamp > 60_000) continue;
              const updated = [...previous];
              updated[index] = {
                ...candidate,
                phase,
                text: normalizedText,
                timestamp: nextTimestamp,
                toolName: normalizedToolName || candidate.toolName,
                toolCallId: normalizedToolCallId,
                sandboxProvider: normalizedSandboxProvider || candidate.sandboxProvider,
              };
              return sortAndMergeActivities(updated);
            }
          }

          if (normalizedToolName) {
            for (let index = previous.length - 1; index >= 0; index -= 1) {
              const candidate = previous[index];
              if (candidate.phase !== "start") continue;
              if ((candidate.toolName || "").trim().toLowerCase() !== normalizedToolName) continue;
              if (nextTimestamp - candidate.timestamp > 60_000) continue;
              const updated = [...previous];
              updated[index] = {
                ...candidate,
                phase,
                text: normalizedText,
                timestamp: nextTimestamp,
                toolName: normalizedToolName,
                toolCallId: normalizedToolCallId || candidate.toolCallId,
                sandboxProvider: normalizedSandboxProvider || candidate.sandboxProvider,
              };
              return sortAndMergeActivities(updated);
            }
          }
        }

        const previousLast = previous[previous.length - 1];
        if (
          previousLast &&
          previousLast.phase === phase &&
          normalizeActivityTextForPhase(previousLast.text, phase) === normalizedText &&
          (normalizedToolCallId
            ? (previousLast.toolCallId || "").trim().toLowerCase() === normalizedToolCallId
            : true) &&
          (normalizedToolName
            ? (previousLast.toolName || "").trim().toLowerCase() === normalizedToolName
            : true) &&
          nextTimestamp - previousLast.timestamp < 750
        ) {
          return previous;
        }

        const next: LiveActivityItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          phase,
          text: normalizedText,
          timestamp: nextTimestamp,
          toolName: normalizedToolName || undefined,
          toolCallId: normalizedToolCallId || undefined,
          sandboxProvider: normalizedSandboxProvider,
        };
        return sortAndMergeActivities([...previous, next]);
      };

      liveRunBufferRef.current = applyActivityEvent(liveRunBufferRef.current);
      setLiveActivities((previous) => applyActivityEvent(previous));
    },
    []
  );

  const hydrateSessionStatus = useCallback(
    async (targetSessionId?: string | null) => {
      const resolvedSessionId =
        typeof targetSessionId === "string" && targetSessionId.trim().length > 0
          ? targetSessionId.trim()
          : null;
      if (!resolvedSessionId) return;

      try {
        const response = await chatApi.getSessionStatus(resolvedSessionId);
        if (!response.success || !response.data) return;
        if (activeSessionRef.current !== resolvedSessionId) return;

        const snapshot = response.data.session;
        if (!snapshot) {
          if (!sendingRef.current) {
            clearLiveRunState();
          }
          return;
        }

        if (typeof snapshot.agentId === "string" && snapshot.agentId.trim()) {
          setActiveAgentId(snapshot.agentId.trim());
        }

        const snapshotActivities = toIdeLiveActivityItems(snapshot.activities);
        if (snapshotActivities.length > 0) {
          setLiveActivities(snapshotActivities);
          liveRunBufferRef.current = snapshotActivities.map((activity) => ({ ...activity }));
        } else if (!sendingRef.current) {
          setLiveActivities([]);
          liveRunBufferRef.current = [];
        }

        const latestTimestamp = Math.max(
          typeof snapshot.timestamp === "number" && Number.isFinite(snapshot.timestamp)
            ? snapshot.timestamp
            : 0,
          ...snapshotActivities.map((activity) => activity.timestamp)
        );
        if (latestTimestamp > 0) {
          latestStatusTimestampBySessionRef.current[resolvedSessionId] = latestTimestamp;
        }

        const nextStatus =
          snapshot.status === "generating"
            ? "generating"
            : snapshot.status === "idle"
              ? "idle"
              : "thinking";
        setLiveStatus(nextStatus);

        const detail = typeof snapshot.detail === "string" ? snapshot.detail.trim() : "";
        const activeStep = getLatestIdeInFlightStep(snapshotActivities);
        if (activeStep && !isGenericIdeStatusLabel(activeStep)) {
          setLiveCurrentStep(activeStep);
        } else if (isMeaningfulIdeThoughtDetail(detail)) {
          setLiveCurrentStep(detail);
        } else if (nextStatus === "generating") {
          setLiveCurrentStep("Generating response...");
        } else if (nextStatus === "thinking") {
          setLiveCurrentStep("Thinking...");
        } else if (!sendingRef.current) {
          setLiveCurrentStep(null);
        }
      } catch {
        // Keep the IDE chat usable if status hydration fails.
      }
    },
    [clearLiveRunState]
  );

  useEffect(() => {
    if (!selectedAgentId || sessionId) return;
    setActiveAgentId(selectedAgentId);
  }, [selectedAgentId, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setSessionTitle(null);
      setActiveAgentId(selectedAgentId || null);
      clearLiveRunState();
      return;
    }

    let isCancelled = false;
    const hydrateSessionMeta = async () => {
      try {
        const response = await chatApi.getSession(sessionId);
        if (!response.success || !response.data || isCancelled) return;
        setSessionTitle(
          typeof response.data.title === "string" && response.data.title.trim()
            ? response.data.title.trim()
            : null
        );
        if (typeof response.data.agent_id === "string" && response.data.agent_id.trim()) {
          setActiveAgentId(response.data.agent_id.trim());
        }
      } catch {
        if (!isCancelled) {
          setSessionTitle(null);
        }
      }
    };

    void hydrateSessionMeta();
    void hydrateSessionStatus(sessionId);

    return () => {
      isCancelled = true;
    };
  }, [clearLiveRunState, hydrateSessionStatus, selectedAgentId, sessionId]);

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "snapshot") {
          const activeSession = activeSessionRef.current;
          if (activeSession) {
            void hydrateSessionStatus(activeSession);
          }
          return;
        }
        if (payload.type !== "status") return;

        const activeSession = activeSessionRef.current;
        const payloadSessionId =
          typeof payload.sessionId === "string" && payload.sessionId.trim()
            ? payload.sessionId.trim()
            : null;
        if (!activeSession || !payloadSessionId || payloadSessionId !== activeSession) return;

        const payloadTimestamp =
          typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
            ? payload.timestamp
            : 0;
        if (payloadTimestamp > 0) {
          const previousTimestamp =
            latestStatusTimestampBySessionRef.current[payloadSessionId] || 0;
          if (payloadTimestamp < previousTimestamp) {
            return;
          }
          latestStatusTimestampBySessionRef.current[payloadSessionId] = payloadTimestamp;
        }

        if (typeof payload.agentId === "string" && payload.agentId.trim()) {
          setActiveAgentId(payload.agentId.trim());
        }

        if (payload.status === "thinking" || payload.status === "generating") {
          const nextStatus = payload.status === "generating" ? "generating" : "thinking";
          setLiveStatus(nextStatus);
          if (!payload.toolName) {
            const activeStep = getLatestIdeInFlightStep(liveRunBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            if (isMeaningfulIdeThoughtDetail(detail)) {
              appendLiveActivity("result", detail, "__thought", payloadTimestamp);
              setLiveCurrentStep(activeStep || detail);
            } else {
              setLiveCurrentStep(
                activeStep ||
                  (nextStatus === "generating" ? "Generating response..." : "Thinking...")
              );
            }
          }
          return;
        }

        if (payload.status === "idle") {
          setLiveStatus("idle");
          if (!sendingRef.current) {
            clearLiveRunState();
          }
          return;
        }

        if (
          payload.status === "tool_executing" ||
          payload.status === "tool_completed" ||
          payload.status === "error"
        ) {
          const phase: "start" | "result" | "error" =
            payload.status === "tool_executing"
              ? "start"
              : payload.status === "tool_completed"
                ? "result"
                : "error";
          const text = formatIdeStatusEventText(payload.toolName, phase, payload.detail);
          appendLiveActivity(
            phase,
            text,
            payload.toolName,
            payloadTimestamp || undefined,
            payload.toolCallId,
            payload.sandboxProvider
          );
          setLiveStatus("thinking");
          if (phase === "start") {
            setLiveCurrentStep(isGenericIdeStatusLabel(text) ? "Thinking..." : text);
          } else {
            setLiveCurrentStep(getLatestIdeInFlightStep(liveRunBufferRef.current));
          }
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [appendLiveActivity, clearLiveRunState, hydrateSessionStatus]);

  useEffect(() => {
    return () => {
      activeRequestAbortRef.current?.abort();
      activeRequestAbortRef.current = null;
    };
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    const sessionCurrentlyActive =
      liveStatus !== "idle" || liveActivities.length > 0 || !!liveCurrentStep;
    if (!trimmed || isSending || isReverting || sessionCurrentlyActive) return;

    activeRequestAbortRef.current?.abort();
    const controller = new AbortController();
    activeRequestAbortRef.current = controller;
    const requestSessionId = sessionId || crypto.randomUUID();

    const userMessage: IdeChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setSessionId(requestSessionId);
    setMessages((previous) => [...previous, userMessage]);
    setInput("");
    setIsSending(true);
    setError(null);
    setActiveAgentId(selectedAgentId || activeAgentId);
    setLiveStatus("thinking");
    setLiveCurrentStep("Thinking...");
    setLiveActivities([]);
    liveRunBufferRef.current = [];
    latestStatusTimestampBySessionRef.current[requestSessionId] = 0;

    const contextParts: string[] = [];
    if (contextPath) {
      contextParts.push(`Current IDE file context: ${contextPath}`);
    }
    if (terminalContext?.isOpen) {
      contextParts.push(
        `IDE terminal context: open (${terminalContext.sessionCount} session${terminalContext.sessionCount === 1 ? "" : "s"})${terminalContext.activeSessionId ? `, active=${terminalContext.activeSessionId}` : ""}`
      );
    }
    const contextualPrompt =
      contextParts.length > 0 ? `${trimmed}\n\n${contextParts.join("\n")}` : trimmed;

    try {
      const response = await chatApi.send(
        contextualPrompt,
        selectedAgentId || undefined,
        requestSessionId,
        workspaceDir || null,
        controller.signal
      );
      if (activeRequestAbortRef.current !== controller) return;
      if (!response.success || !response.data) {
        clearLiveRunState();
        setError(response.error || "Failed to send message");
        return;
      }
      setSessionId(response.data.sessionId || requestSessionId);
      const mappedAssistant = mapApiMessageToIde(response.data.message);
      const bufferedActivities = finalizeCompletedActivities(
        mergeActivityLists([], liveRunBufferRef.current)
      );
      const assistantMessageBase: IdeChatMessage =
        mappedAssistant ||
        ({
          role: "assistant",
          content: response.data.message?.content || "(No assistant response)",
          timestamp: new Date().toISOString(),
        } satisfies IdeChatMessage);
      const toolFallbackActivities =
        bufferedActivities.length === 0
          ? finalizeCompletedActivities(
              buildActivitiesFromToolCalls(
                assistantMessageBase.tool_calls,
                (toolName, _args, phase) => formatIdeStatusEventText(toolName, phase)
              )
            )
          : [];
      const resolvedFallbackActivities =
        bufferedActivities.length > 0 ? bufferedActivities : toolFallbackActivities;
      const assistantMessage: IdeChatMessage =
        !assistantMessageBase.process_activities ||
        assistantMessageBase.process_activities.length === 0
          ? resolvedFallbackActivities.length > 0
            ? {
                ...assistantMessageBase,
                process_activities: resolvedFallbackActivities.map((activity) => ({ ...activity })),
              }
            : assistantMessageBase
          : assistantMessageBase;
      setMessages((previous) => [...previous, assistantMessage]);
      clearLiveRunState();
    } catch (sendError) {
      clearLiveRunState();
      const isAbortError =
        sendError instanceof DOMException
          ? sendError.name === "AbortError"
          : !!sendError &&
            typeof sendError === "object" &&
            "name" in sendError &&
            (sendError as { name?: string }).name === "AbortError";
      if (isAbortError) return;
      setError(String(sendError));
    } finally {
      if (activeRequestAbortRef.current === controller) {
        activeRequestAbortRef.current = null;
      }
      setIsSending(false);
    }
  }, [
    activeAgentId,
    clearLiveRunState,
    contextPath,
    input,
    isReverting,
    isSending,
    liveActivities.length,
    liveCurrentStep,
    liveStatus,
    mapApiMessageToIde,
    selectedAgentId,
    sessionId,
    terminalContext,
    workspaceDir,
  ]);

  const handleStopActive = useCallback(async () => {
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    setIsSending(false);
    clearLiveRunState();
    const targetAgentId = activeAgentId || selectedAgentId || null;
    if (!targetAgentId) return;
    try {
      await stopAgent.mutateAsync(targetAgentId);
    } catch {
      // Keep the UI responsive even if the stop request fails.
    }
  }, [activeAgentId, clearLiveRunState, selectedAgentId, stopAgent]);

  const handleNewChat = useCallback(() => {
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    setSessionId(null);
    setSessionTitle(null);
    setActiveAgentId(selectedAgentId || null);
    setMessages([]);
    setInput("");
    setIsSending(false);
    setError(null);
    setFileDiffDecision({});
    setResolvedPendingDiffs({});
    setExpandedDiffs({});
    clearLiveRunState();
  }, [clearLiveRunState, selectedAgentId]);

  const handleRevertToHere = useCallback(
    async (messageIndex: number) => {
      if (!sessionId || isSending || isReverting) return;
      const target = messages[messageIndex];
      if (!target || target.role !== "user") return;
      const confirmed = window.confirm(
        "Revert this IDE chat session to this message? Later messages will be removed."
      );
      if (!confirmed) return;
      setIsReverting(true);
      setError(null);
      try {
        const response = await chatApi.revertSession(sessionId, {
          messageIndex,
          messageRole: target.role,
          messageContent: target.content,
          messageTimestamp: target.timestamp,
        });
        if (!response.success || !response.data) {
          setError(response.error || "Failed to revert session");
          return;
        }
        const revertedMessages = Array.isArray(response.data.messagesList)
          ? response.data.messagesList
              .map((message) => mapApiMessageToIde(message))
              .filter((message): message is IdeChatMessage => !!message)
          : [];
        if (revertedMessages.length > 0) {
          setMessages(revertedMessages);
        } else {
          setMessages(messages.slice(0, messageIndex + 1));
        }
        setFileDiffDecision({});
        setResolvedPendingDiffs({});
        setExpandedDiffs({});
        setInput(target.content);
      } catch (revertError) {
        setError(String(revertError));
      } finally {
        setIsReverting(false);
      }
    },
    [isReverting, isSending, mapApiMessageToIde, messages, sessionId]
  );

  const setDecisionForFileKeys = useCallback(
    (keys: string[], decision: "accepted" | "rejected") => {
      if (keys.length === 0) return;
      setFileDiffDecision((previous) => {
        const next = { ...previous };
        for (const key of keys) {
          next[key] = decision;
        }
        return next;
      });
    },
    []
  );

  const applyReversePatchForFiles = useCallback(
    async (files: IdePendingFileDiff[]): Promise<boolean> => {
      const patchParts: string[] = [];
      for (const file of files) {
        const diff = typeof file.diff === "string" ? file.diff : "";
        if (!diff.trim()) continue;
        const reversePatch = reverseUnifiedDiff(diff, file.type);
        if (!reversePatch) {
          setError(`Cannot auto-reject ${file.path} because its diff is missing or truncated.`);
          return false;
        }
        patchParts.push(reversePatch.trimEnd());
      }

      if (patchParts.length === 0) {
        setError("No reversible file diffs found for this selection.");
        return false;
      }

      setIsApplyingDiffAction(true);
      setError(null);
      try {
        const response = await apiFetch("/api/tools/execute", {
          method: "POST",
          body: JSON.stringify({
            name: "apply_patch",
            args: { patch: `${patchParts.join("\n\n")}\n` },
            context: {
              workspaceDir,
              sessionId: sessionId || "ide-chat",
              agentId: selectedAgentId || "ide-chat",
              channel: "ide",
              userId: "ide-user",
              allowDangerousTools: true,
            },
          }),
        });
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          const message =
            typeof payload.error === "string" && payload.error.trim()
              ? payload.error
              : "Failed to apply reverse patch.";
          setError(message);
          return false;
        }
        if (payload.success === false) {
          const failed = Array.isArray(payload.failed)
            ? payload.failed
                .map((entry) =>
                  isPlainRecord(entry) && typeof entry.error === "string" ? entry.error : null
                )
                .filter((entry): entry is string => !!entry)
            : [];
          const message = failed.length > 0 ? failed.join(" | ") : "Failed to apply reverse patch.";
          setError(message);
          return false;
        }

        onWorkspaceMutated();
        return true;
      } catch (applyError) {
        setError(String(applyError));
        return false;
      } finally {
        setIsApplyingDiffAction(false);
      }
    },
    [onWorkspaceMutated, selectedAgentId, sessionId, workspaceDir]
  );

  const getPendingFilesForMessage = useCallback(
    (messageKey: string): IdePendingFileDiff[] =>
      (resolvedFileEntriesByMessageKey.get(messageKey) || []).filter(
        (file) => !fileDiffDecision[file.key]
      ),
    [fileDiffDecision, resolvedFileEntriesByMessageKey]
  );

  const handleAcceptFileChange = useCallback(
    (fileKey: string) => {
      setDecisionForFileKeys([fileKey], "accepted");
    },
    [setDecisionForFileKeys]
  );

  const handleAcceptMessageChanges = useCallback(
    (messageKey: string) => {
      const files = getPendingFilesForMessage(messageKey);
      if (files.length === 0) return;
      setDecisionForFileKeys(
        files.map((file) => file.key),
        "accepted"
      );
    },
    [getPendingFilesForMessage, setDecisionForFileKeys]
  );

  const handleAcceptAllMessageChanges = useCallback(() => {
    if (pendingFileDiffs.length === 0) return;
    setDecisionForFileKeys(
      pendingFileDiffs.map((file) => file.key),
      "accepted"
    );
  }, [pendingFileDiffs, setDecisionForFileKeys]);

  const handleRejectFileChange = useCallback(
    async (fileKey: string) => {
      if (isSending || isReverting || isApplyingDiffAction) return;
      const file = pendingFileDiffs.find((entry) => entry.key === fileKey);
      if (!file) return;
      const confirmed = window.confirm(
        `Reject changes for ${file.path}? Cybara will apply a reverse patch to undo them.`
      );
      if (!confirmed) return;
      const ok = await applyReversePatchForFiles([file]);
      if (ok) {
        setDecisionForFileKeys([file.key], "rejected");
      }
    },
    [
      applyReversePatchForFiles,
      isApplyingDiffAction,
      isReverting,
      isSending,
      pendingFileDiffs,
      setDecisionForFileKeys,
    ]
  );

  const handleRejectMessageChanges = useCallback(
    async (messageKey: string) => {
      if (isSending || isReverting || isApplyingDiffAction) return;
      const files = getPendingFilesForMessage(messageKey);
      if (files.length === 0) return;
      const confirmed = window.confirm(
        "Reject these file changes? Cybara will apply a reverse patch to undo them."
      );
      if (!confirmed) return;
      const ok = await applyReversePatchForFiles(files);
      if (ok) {
        setDecisionForFileKeys(
          files.map((file) => file.key),
          "rejected"
        );
      }
    },
    [
      applyReversePatchForFiles,
      getPendingFilesForMessage,
      isApplyingDiffAction,
      isReverting,
      isSending,
      setDecisionForFileKeys,
    ]
  );

  const handleRejectAllMessageChanges = useCallback(async () => {
    if (pendingFileDiffs.length === 0 || isSending || isReverting || isApplyingDiffAction) {
      return;
    }
    const confirmed = window.confirm(
      `Reject all pending file changes (${pendingFileDiffs.length} file${pendingFileDiffs.length === 1 ? "" : "s"})?`
    );
    if (!confirmed) return;
    const ok = await applyReversePatchForFiles(pendingFileDiffs);
    if (ok) {
      setDecisionForFileKeys(
        pendingFileDiffs.map((file) => file.key),
        "rejected"
      );
    }
  }, [
    applyReversePatchForFiles,
    isApplyingDiffAction,
    isReverting,
    isSending,
    pendingFileDiffs,
    setDecisionForFileKeys,
  ]);

  const handleCopyToolCommand = useCallback(async (key: string, command: string) => {
    if (!command.trim()) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopiedToolCallKey(key);
      window.setTimeout(() => {
        setCopiedToolCallKey((current) => (current === key ? null : current));
      }, 1500);
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    onPendingFileDiffControllerChange?.({
      items: pendingFileDiffs,
      acceptFile: handleAcceptFileChange,
      rejectFile: handleRejectFileChange,
      acceptAll: handleAcceptAllMessageChanges,
      rejectAll: handleRejectAllMessageChanges,
    });
  }, [
    handleAcceptAllMessageChanges,
    handleAcceptFileChange,
    handleRejectAllMessageChanges,
    handleRejectFileChange,
    onPendingFileDiffControllerChange,
    pendingFileDiffs,
  ]);

  useEffect(() => {
    return () => {
      onPendingFileDiffControllerChange?.(null);
    };
  }, [onPendingFileDiffControllerChange]);

  return (
    <div className="h-full flex flex-col bg-[#0a0a12]">
      <div className="px-3 py-2 border-b border-white/10 flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2 text-xs text-gray-300">
          <div className="mt-0.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 p-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-gray-100">{conversationTitle}</span>
              {showWorkingTimeline && (
                <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
                  Working
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
              <span>{conversationAgentLabel}</span>
              {sessionId && (
                <span className="font-mono text-gray-600">{sessionId.slice(0, 8)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {showWorkingTimeline && (
            <button
              type="button"
              onClick={() => void handleStopActive()}
              disabled={stopAgent.isPending}
              className="inline-flex h-7 items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 text-[11px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              title="Stop active run"
            >
              {stopAgent.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapseProgressUpdates((previous) => !previous)}
            className="h-7 px-2 rounded text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/5"
            title={
              collapseProgressUpdates ? "Expand progress updates" : "Collapse progress updates"
            }
          >
            {collapseProgressUpdates ? "Expand all" : "Collapse all"}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="h-7 px-2 text-[11px]"
            title="Start new IDE chat session"
          >
            New
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-white/5"
            title="Close IDE chat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {contextPath && (
        <div
          className="px-3 py-2 border-b border-white/10 text-[11px] text-gray-500 truncate"
          title={contextPath}
        >
          Context: {contextPath}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 ? (
          <div className="text-xs text-gray-500">
            Ask about the current workspace or file. This panel shares session context while open.
          </div>
        ) : (
          messages.map((message, index) =>
            (() => {
              const messageKey = getMessageKey(message, index);
              const changeSummary =
                message.role === "assistant"
                  ? messageChangeSummaryByKey.get(messageKey) || null
                  : null;
              const resolvedMessageFiles =
                message.role === "assistant"
                  ? resolvedFileEntriesByMessageKey.get(messageKey) || []
                  : [];
              const pendingMessageFiles = resolvedMessageFiles.filter(
                (file) => !fileDiffDecision[file.key]
              );
              const acceptedMessageFiles = resolvedMessageFiles.filter(
                (file) => fileDiffDecision[file.key] === "accepted"
              ).length;
              const rejectedMessageFiles = resolvedMessageFiles.filter(
                (file) => fileDiffDecision[file.key] === "rejected"
              ).length;
              const messageResolutionLabel =
                pendingMessageFiles.length > 0 || resolvedMessageFiles.length === 0
                  ? null
                  : acceptedMessageFiles === resolvedMessageFiles.length
                    ? "Accepted"
                    : rejectedMessageFiles === resolvedMessageFiles.length
                      ? "Rejected"
                      : "Resolved";
              const processActivities =
                message.role === "assistant" && Array.isArray(message.process_activities)
                  ? message.process_activities
                  : [];
              const orderedToolCalls =
                message.role === "assistant" && Array.isArray(message.tool_calls)
                  ? getIdeToolCallsInTimelineOrder(message.tool_calls)
                  : [];
              const richToolCalls = orderedToolCalls.filter((toolCall) => {
                return (
                  !!getIdeToolCallCommand(toolCall) ||
                  !!getIdeToolCallResultSummary(toolCall) ||
                  getIdeToolCallExitCode(toolCall) !== null
                );
              });
              return (
                <div
                  key={messageKey}
                  className={cn(
                    "rounded-md px-2.5 py-2 text-xs whitespace-pre-wrap break-words border",
                    message.role === "user"
                      ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-100"
                      : "border-white/10 bg-black/30 text-gray-200"
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                    <span>{message.role === "user" ? "You" : "Assistant"}</span>
                    <div className="flex items-center gap-2">
                      <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                      {message.role === "user" && sessionId && (
                        <button
                          type="button"
                          disabled={isReverting || isSending || isApplyingDiffAction}
                          onClick={() => void handleRevertToHere(index)}
                          className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 p-1 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Revert this IDE chat session to this message"
                          aria-label="Revert to here"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {message.role === "assistant" ? (
                    <div className="text-[12px] leading-6">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={ideMarkdownComponents}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div>{message.content}</div>
                  )}

                  {message.role === "assistant" && message.thinking && (
                    <div className="mt-2 rounded border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-200">
                      {message.thinking}
                    </div>
                  )}

                  {message.role === "assistant" && changeSummary && (
                    <div className="mt-2 rounded border border-white/10 bg-black/25 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">
                        Files Edited
                      </div>
                      <div className="mt-1 space-y-1">
                        {resolvedMessageFiles.map((file) => (
                          <div
                            key={`${messageKey}:files-edited:${file.path}`}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <span className="truncate text-gray-200" title={file.path}>
                              {file.path}
                            </span>
                            <span className="shrink-0 text-gray-500">
                              <span className="text-emerald-300">+{file.added}</span>{" "}
                              <span className="text-red-300">-{file.removed}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {message.role === "assistant" &&
                    (processActivities.length > 0 || richToolCalls.length > 0) && (
                      <div className="mt-2 rounded border border-white/10 bg-black/25 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">
                            Progress Updates
                          </div>
                          <button
                            type="button"
                            onClick={() => setCollapseProgressUpdates((previous) => !previous)}
                            className="text-[10px] text-gray-500 hover:text-gray-300"
                            title={
                              collapseProgressUpdates
                                ? "Expand all progress updates"
                                : "Collapse all progress updates"
                            }
                          >
                            {collapseProgressUpdates ? "Expand all" : "Collapse all"}
                          </button>
                        </div>
                        {!collapseProgressUpdates && (
                          <div className="mt-1 space-y-2">
                            {processActivities.length > 0 && (
                              <div className="rounded border border-white/10 bg-black/30 px-2 py-2">
                                <IdeProcessActivityList activities={processActivities} />
                              </div>
                            )}
                            {richToolCalls.map((toolCall, toolIndex) => {
                              const toolKey = `${messageKey}:tool:${toolCall.id || toolIndex}`;
                              const toolName =
                                typeof toolCall.name === "string" ? toolCall.name : "tool";
                              const toolStatus =
                                typeof toolCall.status === "string" ? toolCall.status : "completed";
                              const command = getIdeToolCallCommand(toolCall);
                              const resultSummary = getIdeToolCallResultSummary(toolCall);
                              const exitCode = getIdeToolCallExitCode(toolCall);
                              return (
                                <div
                                  key={toolKey}
                                  className="rounded border border-white/10 bg-black/35 px-2 py-1.5"
                                >
                                  <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                                    <span className="uppercase tracking-wide">
                                      {command ? "Ran command" : toolName}
                                    </span>
                                    <span>{toolStatus}</span>
                                  </div>
                                  {command && (
                                    <div className="mt-1 rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-gray-200 whitespace-pre-wrap break-words">
                                      <div className="flex items-start justify-between gap-2">
                                        <span className="break-all">{command}</span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleCopyToolCommand(toolKey, command)
                                          }
                                          className="shrink-0 rounded border border-white/10 p-1 text-gray-400 hover:text-gray-200 hover:bg-white/5"
                                          title={
                                            copiedToolCallKey === toolKey
                                              ? "Copied"
                                              : "Copy command"
                                          }
                                        >
                                          <Copy className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                  {resultSummary && (
                                    <div className="mt-1 max-h-52 overflow-auto rounded border border-white/10 bg-[#06060b] px-2 py-1.5 font-mono text-[10px] leading-5 text-gray-300 whitespace-pre-wrap break-words">
                                      {resultSummary}
                                    </div>
                                  )}
                                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                                    <span>
                                      {exitCode !== null ? `Exit code ${exitCode}` : "Completed"}
                                    </span>
                                    {copiedToolCallKey === toolKey && (
                                      <span className="text-emerald-300">Copied</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                  {message.role === "assistant" && changeSummary && (
                    <div className="mt-2 rounded border border-white/10 bg-black/35 px-2 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] text-gray-300">
                          Edited files {resolvedMessageFiles.length}{" "}
                          <span className="text-emerald-300">+{changeSummary.totalAdded}</span>{" "}
                          <span className="text-red-300">-{changeSummary.totalRemoved}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {messageResolutionLabel ? (
                            <span
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded border",
                                messageResolutionLabel === "Accepted"
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                  : messageResolutionLabel === "Rejected"
                                    ? "border-red-500/30 bg-red-500/10 text-red-200"
                                    : "border-white/15 bg-white/5 text-gray-300"
                              )}
                            >
                              {messageResolutionLabel}
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleAcceptMessageChanges(messageKey)}
                                disabled={
                                  pendingMessageFiles.length === 0 ||
                                  isSending ||
                                  isReverting ||
                                  isApplyingDiffAction
                                }
                                className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                                title="Accept these file changes"
                              >
                                <Check className="w-3 h-3 mr-1" />
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRejectMessageChanges(messageKey)}
                                disabled={
                                  pendingMessageFiles.length === 0 ||
                                  isSending ||
                                  isReverting ||
                                  isApplyingDiffAction
                                }
                                className="inline-flex items-center rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                                title="Reject and undo these file changes"
                              >
                                {isApplyingDiffAction ? (
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3 h-3 mr-1" />
                                )}
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {resolvedMessageFiles.map((file) => {
                          const diffKey = `${messageKey}:${file.path}`;
                          const isExpanded = !!expandedDiffs[diffKey];
                          const fileDecision = fileDiffDecision[file.key];
                          return (
                            <div
                              key={`${messageKey}:file:${file.path}`}
                              className="rounded border border-white/10 bg-black/30"
                            >
                              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                                <div className="min-w-0">
                                  <div className="truncate text-gray-200" title={file.path}>
                                    {file.path}
                                  </div>
                                  <div className="text-[10px] text-gray-500">
                                    {file.type} ·{" "}
                                    <span className="text-emerald-300">+{file.added}</span>{" "}
                                    <span className="text-red-300">-{file.removed}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {fileDecision && (
                                    <span
                                      className={cn(
                                        "rounded border px-1.5 py-0.5 text-[10px]",
                                        fileDecision === "accepted"
                                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                          : "border-red-500/30 bg-red-500/10 text-red-200"
                                      )}
                                    >
                                      {fileDecision === "accepted" ? "Accepted" : "Rejected"}
                                    </span>
                                  )}
                                  {file.diff && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedDiffs((previous) => ({
                                          ...previous,
                                          [diffKey]: !previous[diffKey],
                                        }))
                                      }
                                      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-white/5"
                                    >
                                      {isExpanded ? "Hide diff" : "Show diff"}
                                    </button>
                                  )}
                                </div>
                              </div>
                              {isExpanded && file.diff && (
                                <div className="max-h-52 overflow-auto border-t border-white/10 bg-[#06060b] px-2 py-1.5 font-mono text-[10px] leading-4">
                                  {file.diff.split(/\r?\n/).map((line, lineIndex) => {
                                    const isAdd = line.startsWith("+") && !line.startsWith("+++");
                                    const isRemove =
                                      line.startsWith("-") && !line.startsWith("---");
                                    const isHeader =
                                      line.startsWith("diff --git") ||
                                      line.startsWith("--- ") ||
                                      line.startsWith("+++ ");
                                    const isHunk = line.startsWith("@@");
                                    return (
                                      <div
                                        key={`${diffKey}:line:${lineIndex}`}
                                        className={cn(
                                          "whitespace-pre",
                                          isAdd && "bg-emerald-500/15 text-emerald-200",
                                          isRemove && "bg-red-500/15 text-red-200",
                                          isHeader && "text-sky-300",
                                          isHunk && "text-indigo-300",
                                          !isAdd &&
                                            !isRemove &&
                                            !isHeader &&
                                            !isHunk &&
                                            "text-gray-300"
                                        )}
                                      >
                                        {line || " "}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )
        )}
        {showWorkingTimeline && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200/80">
              <Sparkles className="w-3 h-3" />
              Working
            </div>
            <IdeLiveActivityTimeline
              status={liveStatus}
              activities={liveActivities}
              currentStep={liveCurrentStep}
            />
          </div>
        )}
        {isReverting && (
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Reverting session...
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/10 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {pendingMessageChangeKeys.length > 0 && (
        <div className="px-3 py-2 border-t border-indigo-500/20 bg-[#121423] flex items-center justify-between gap-2">
          <div className="text-[11px] text-gray-200 min-w-0 truncate">
            {pendingChangeAggregate.fileCount} file
            {pendingChangeAggregate.fileCount === 1 ? "" : "s"} with changes{" "}
            <span className="text-emerald-300">+{pendingChangeAggregate.totalAdded}</span>{" "}
            <span className="text-red-300">-{pendingChangeAggregate.totalRemoved}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleRejectAllMessageChanges()}
              disabled={isApplyingDiffAction || isSending || isReverting}
              className="inline-flex items-center rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              title="Reject all pending file changes"
            >
              {isApplyingDiffAction ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="w-3 h-3 mr-1" />
              )}
              Reject all
            </button>
            <button
              type="button"
              onClick={handleAcceptAllMessageChanges}
              disabled={isApplyingDiffAction || isSending || isReverting}
              className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              title="Accept all pending file changes"
            >
              <Check className="w-3 h-3 mr-1" />
              Accept all
            </button>
          </div>
        </div>
      )}

      <div className="p-3 border-t border-white/10 space-y-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Message IDE chat (Shift+Enter for newline)"
          disabled={isApplyingDiffAction}
          className="w-full min-h-[82px] max-h-56 px-2 py-1.5 rounded border border-white/10 bg-black/40 text-xs text-gray-200 !outline-none focus:border-indigo-500/40 resize-y"
        />
        <div className="flex items-center gap-2">
          <select
            value={selectedAgentId}
            onChange={(event) => onSelectedAgentIdChange(event.target.value)}
            className="flex-1 min-w-0 px-2 py-1 rounded border border-white/10 bg-black/40 text-[11px] text-gray-200 !outline-none focus:border-indigo-500/40"
            title="Agent for IDE chat"
          >
            <option value="">Default Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
                {agent.status ? ` (${agent.status})` : ""}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            disabled={
              isSending ||
              isReverting ||
              isApplyingDiffAction ||
              showWorkingTimeline ||
              !input.trim()
            }
            onClick={() => void handleSend()}
            className="h-7 px-2.5"
          >
            {showWorkingTimeline ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <MessageSquare className="w-3.5 h-3.5" />
            )}
            <span className="ml-1 text-xs">{showWorkingTimeline ? "Running" : "Send"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
