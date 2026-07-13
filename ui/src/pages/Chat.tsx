import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  FlaskConical,
  Folder,
  GitFork,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  PanelRightOpen,
  Paperclip,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmbeddedTerminalPanel } from "@/components/ide/EmbeddedTerminalPanel";
import { LocalFolderPickerModal } from "@/components/LocalFolderPickerModal";
import { PageLayout } from "@/components/layout";
import { Badge, Button, GlassCard, Input, Modal } from "@/components/ui";
import {
  useAgentSummaries,
  useInfo,
  useStopAgent,
  useSubagents,
  useUpdateAgentReasoning,
} from "@/hooks/useApi";
import { useChat, useLoadSession, useUpdateSessionAgent } from "@/hooks/useChat";
import { chatApi, providerPlansApi, settingsApi } from "@/lib/api";
import { apiFetch, appendApiTokenParam } from "@/lib/auth";
import {
  audioBlobToBase64,
  audioBlobToLocalPcm,
  preferredRecordingMimeType,
} from "@/lib/audioTranscription";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  type LiveActivityItem,
  mergeActivityLists,
  suppressRecoveredWebFailureActivities,
} from "@/lib/chatActivities";
import { loadPersistedCompletion } from "@/lib/chatCompletion";
import {
  type ChatFileAttachment,
  chatImageSrc,
  fileToChatImage,
  fileToTextAttachment,
  formatAttachedFiles,
  formatBytes,
  imageAttachmentBytes,
  imageToolResultSrc,
  isSupportedImageType,
  isTextLikeFile,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGES,
  MAX_TEXT_FILE_BYTES,
  MAX_TEXT_FILES,
  mediaSummaryLabel,
} from "@/lib/chatImages";
import {
  isDesktopHostRuntime,
  isTauriDesktopRuntime,
  openDesktopDirectoryDialog,
} from "@/lib/desktopHost";
import { useI18n } from "@/lib/i18n";
import {
  nativeAudioErrorMessage,
  nativeRecordingBlob,
  startNativeAudioRecording,
  stopNativeAudioRecording,
} from "@/lib/nativeDesktopAudio";
import {
  connectStatusStream,
  type PendingChatMessage,
  type StatusSessionSnapshot,
  type StatusStreamStatusEvent,
  type StatusStreamTokenEvent,
} from "@/lib/status-stream";
import { formatRelativeTime } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
import type {
  Agent,
  ChatImageAttachment,
  ProviderPlanSnapshot,
  ProviderPlanStatusResponse,
  SessionContextUsage,
  SessionTokenUsage,
} from "@/types";
import { LiveActivityTimeline, ProcessActivityList } from "./chat/ActivityTimeline";
import { ArtifactViewerPanel } from "./chat/ArtifactViewerPanel";
import { ChatAgentControls, MODEL_ROUTER_SELECTOR_VALUE } from "./chat/ChatAgentControls";
import { ChatCapabilityMenu } from "./chat/ChatCapabilityMenu";
import { ChatComposerActionButton } from "./chat/ChatComposerActionButton";
import { ChatEnvironmentOverview } from "./chat/ChatEnvironmentOverview";
import {
  ChatApprovalControls,
  normalizeToolApprovalMode,
  PendingChatQueue,
  type ToolApprovalMode,
} from "./chat/ChatFollowUpControls";
import { ChatHeaderTitleMenu } from "./chat/ChatHeaderTitleMenu";
import { ChatImageLightbox, type ChatLightboxImage } from "./chat/ChatImageLightbox";
import { ChatReasoningControl } from "./chat/ChatReasoningControl";
import { ChatWorkspaceBrowser } from "./chat/ChatWorkspaceBrowser";
import { ChatWorkspaceComputer } from "./chat/ChatWorkspaceComputer";
import { ChatWorkspaceFiles } from "./chat/ChatWorkspaceFiles";
import {
  ChatWorkspacePanel,
  type ChatWorkspaceTab,
  WORKSPACE_SINGLETON_KINDS,
  type WorkspaceTabInstance,
} from "./chat/ChatWorkspacePanel";
import {
  type ArtifactSummaryView,
  applyLiveActivityEvent,
  buildPreSteeringActivityMessage,
  canUseNativeSpeechRecognition,
  type ChatMessage,
  clampDiffPanelWidth,
  type DictationMode,
  type DictationRuntimeCapabilities,
  dedupeArtifactSummaries,
  extractFirstTargetLine,
  extractLatestPlanFromMessages,
  type FileChangeItem,
  type FileChangeSummary,
  formatSandboxProviderLabel,
  formatToolIntent,
  formatWorkspaceLabel,
  getLatestInFlightStep,
  getLegacyMessageProcessKey,
  getMessageProcessActivities,
  getMessageProcessKey,
  getToolCallsInTimelineOrder,
  inferArtifactSummaries,
  isAgentUsingBrowser,
  isGenericStatusLabel,
  isMeaningfulThoughtDetail,
  isRecord,
  isSessionPlanComplete,
  normalizeDictationMode,
  normalizeMessageProcessActivities,
  normalizeSessionStatus,
  normalizeSnapshotActivities,
  PENDING_CAPTURE_TIMEOUT_MS,
  type PendingProcessCapture,
  persistDiffPanelWidth,
  persistMessageProcessMap,
  persistSessionId,
  persistWorkspaceDir,
  pruneCanonicalizedLiveActivities,
  type RevertTarget,
  readPersistedDiffPanelWidth,
  readPersistedMessageProcessMap,
  readPersistedSessionId,
  readPersistedWorkspaceDir,
  resolveDictationRuntime,
  resolvePathForIde,
  resolveStatusSnapshotActivities,
  resolveToolCallSandboxProvider,
  SESSION_ACTIVITY_STALE_MS,
  type SessionStatusResponse,
  type SessionStatusSnapshot,
  type SpeechRecognitionLike,
  type SpeechRecognitionWindow,
  summarizeMessageFileChanges,
  type ToolCall,
  toLiveActivityItems,
  tryParseJsonRecord,
} from "./chat/chatModel";
import { parseInitialChatRoute } from "./chat/chatRoute";
import { isChatNearBottom } from "./chat/chatScroll";
import { FileChangesCard } from "./chat/FileChangesCard";
import { type GitBranchOption, GitBranchSelector } from "./chat/GitBranchSelector";
import {
  clearCachedLiveSessionState,
  readCachedLiveSessionState,
  writeCachedLiveSessionState,
} from "./chat/liveSessionState";
import { MessageContent } from "./chat/MessageContent";
import { writeCachedSessionMessages } from "./chat/messageCache";
import { PendingApprovalsBanner } from "./chat/PendingApprovalsBanner";
import { PlanSummaryCard } from "./chat/PlanSummaryCard";
import {
  clearCachedOptimisticPendingMessages,
  readCachedOptimisticPendingMessages,
  writeCachedOptimisticPendingMessages,
} from "./chat/pendingQueueCache";
import { mergePendingChatMessages, normalizePendingChatMessages } from "./chat/pendingQueueState";
import { SessionsPanel } from "./chat/SessionSidebar";
import { SessionDiffPanel } from "./chat/SessionDiffPanel";
import { SubagentIcon } from "./chat/SubagentIcon";
import { SubagentPanel } from "./chat/SubagentPanel";
import { useChatCapabilityPicker } from "./chat/useChatCapabilityPicker";
import { useEnvironmentGitBranches } from "./chat/useEnvironmentGitBranches";
import { useSessionFileChanges } from "./chat/useSessionFileChanges";
import { WorkspaceOpenMenu } from "./chat/WorkspaceOpenMenu";

type LiveStatusSnapshotLike = StatusSessionSnapshot | SessionStatusSnapshot;

const STOPPED_SESSION_STATUS_SUPPRESSION_MS = 12_000;

function formatWorkedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseDurationMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function inferThoughtActivitiesFromContent(
  content: string,
  baseTimestampMs?: number
): LiveActivityItem[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const toolishLine =
    /^(Ran|Explored|Edited|Created|Deleted|Read|Wrote|Updated|Fetched|Searching)\b/i;
  const thoughtishLine = /^(I'll|I will|Let me|Now let me|Now|Next|First|Then|To start|I’m|I'm)\b/i;

  const fallbackBase =
    typeof baseTimestampMs === "number" && Number.isFinite(baseTimestampMs)
      ? baseTimestampMs
      : Date.now();

  const thoughts: LiveActivityItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (toolishLine.test(line)) continue;
    if (!thoughtishLine.test(line)) continue;
    thoughts.push({
      id: `inferred-thought-${index}-${line.slice(0, 12)}`,
      phase: "result",
      text: line,
      timestamp: fallbackBase + index,
      toolName: "__thought",
    });
  }

  return thoughts;
}

function inferThoughtActivitiesFromThinking(
  thinking: string | undefined,
  baseTimestampMs?: number
): LiveActivityItem[] {
  if (typeof thinking !== "string" || thinking.trim().length === 0) return [];
  const lines = thinking
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const fallbackBase =
    typeof baseTimestampMs === "number" && Number.isFinite(baseTimestampMs)
      ? baseTimestampMs
      : Date.now();

  return lines.map((line, index) => ({
    id: `inferred-thinking-${index}-${line.slice(0, 12)}`,
    phase: "result",
    text: line,
    timestamp: fallbackBase + index,
    toolName: "__thought",
  }));
}

function resolveWorkedDurationMs(
  processActivities?: LiveActivityItem[],
  toolCalls?: ToolCall[],
  options?: {
    assistantTimestamp?: string;
    turnStartedAtMs?: number;
  }
): number | undefined {
  const activityTimestamps = (processActivities || [])
    .map((activity) => activity.timestamp)
    .filter((timestamp): timestamp is number => Number.isFinite(timestamp));
  const assistantTimestampMs = parseTimestampMs(options?.assistantTimestamp);
  const turnStartedAtMs = options?.turnStartedAtMs;
  const durationCandidates: number[] = [];

  const addDurationCandidate = (value: number | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
    durationCandidates.push(value);
  };

  if (activityTimestamps.length >= 2) {
    const minTimestamp = Math.min(...activityTimestamps);
    const maxTimestamp = Math.max(...activityTimestamps);
    addDurationCandidate(maxTimestamp - minTimestamp);
  }

  if (activityTimestamps.length > 0) {
    const minTimestamp = Math.min(...activityTimestamps);
    const maxTimestamp = Math.max(...activityTimestamps);
    const inferredStart =
      typeof turnStartedAtMs === "number" && Number.isFinite(turnStartedAtMs)
        ? Math.min(turnStartedAtMs, minTimestamp)
        : minTimestamp;
    const inferredEnd =
      typeof assistantTimestampMs === "number"
        ? Math.max(assistantTimestampMs, maxTimestamp)
        : maxTimestamp;
    addDurationCandidate(inferredEnd - inferredStart);
  }

  const toolStartTimestamps = (toolCalls || [])
    .map((toolCall) => parseTimestampMs(toolCall.started_at))
    .filter((timestamp): timestamp is number => typeof timestamp === "number");
  if (toolStartTimestamps.length > 0) {
    const minStart = Math.min(...toolStartTimestamps);
    const maxEnd = (toolCalls || []).reduce((currentMax, toolCall) => {
      const startedAt = parseTimestampMs(toolCall.started_at);
      if (typeof startedAt !== "number") return currentMax;
      const duration = parseDurationMs(toolCall.duration);
      const end = duration > 0 ? startedAt + duration : startedAt;
      return Math.max(currentMax, end);
    }, minStart);
    addDurationCandidate(maxEnd - minStart);
  }

  const toolDurationTotal = (toolCalls || []).reduce((sum, toolCall) => {
    const duration = parseDurationMs(toolCall.duration);
    return duration > 0 ? sum + duration : sum;
  }, 0);
  addDurationCandidate(toolDurationTotal);

  if (
    typeof assistantTimestampMs === "number" &&
    typeof turnStartedAtMs === "number" &&
    Number.isFinite(turnStartedAtMs)
  ) {
    addDurationCandidate(assistantTimestampMs - turnStartedAtMs);
  }

  if (durationCandidates.length === 0) return undefined;
  return Math.max(...durationCandidates);
}

function resolveArtifactAction(toolCall: ToolCall): string | undefined {
  const args = toolCall.arguments || toolCall.args || {};
  const actionFromArgs =
    (typeof args.action === "string" ? args.action : "") ||
    (typeof args.mode === "string" ? args.mode : "");
  if (actionFromArgs) return actionFromArgs.toLowerCase();

  const parsedResult = tryParseJsonRecord(toolCall.result);
  if (isRecord(parsedResult) && typeof parsedResult.action === "string") {
    return parsedResult.action.toLowerCase();
  }

  return undefined;
}

function findPriorUserTimestampMs(
  messages: ChatMessage[],
  currentIndex: number
): number | undefined {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (!candidate || candidate.role !== "user") continue;
    const timestamp = parseTimestampMs(candidate.timestamp);
    if (typeof timestamp === "number") {
      return timestamp;
    }
  }
  return undefined;
}

const ARTIFACT_MUTATION_ACTIONS = new Set(["create", "update", "append", "check"]);

function isArtifactMutationAction(action: string): boolean {
  return ARTIFACT_MUTATION_ACTIONS.has(action);
}

function hasArtifactMutationResult(toolCall: ToolCall): boolean {
  const parsedResult = tryParseJsonRecord(toolCall.result);
  if (!isRecord(parsedResult)) return false;

  if (
    parsedResult.created === true ||
    parsedResult.updated === true ||
    parsedResult.appended === true ||
    parsedResult.checked === true
  ) {
    return true;
  }

  const actionFromResult =
    typeof parsedResult.action === "string" ? parsedResult.action.toLowerCase() : "";
  if (actionFromResult && isArtifactMutationAction(actionFromResult)) {
    return true;
  }

  return false;
}

function collectMessageArtifacts(
  toolCalls: ToolCall[] | undefined,
  sessionId?: string | null
): ArtifactSummaryView[] {
  const artifacts: ArtifactSummaryView[] = [];
  for (const toolCall of toolCalls || []) {
    const isArtifactTool = toolCall.name === "artifacts" || toolCall.name === "artifact";
    if (!isArtifactTool) continue;

    const action = resolveArtifactAction(toolCall);
    if (action) {
      if (!isArtifactMutationAction(action)) {
        continue;
      }
    } else if (!hasArtifactMutationResult(toolCall)) {
      continue;
    }

    artifacts.push(...inferArtifactSummaries(toolCall, sessionId));
  }
  return dedupeArtifactSummaries(artifacts);
}

function ArtifactSummaryCard({
  artifacts,
  onOpenArtifact,
}: {
  artifacts: ArtifactSummaryView[];
  onOpenArtifact?: (artifact: ArtifactSummaryView) => void;
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
          {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"} created/updated
        </span>
        <span className="flex-1" />
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-white/5 px-3 py-2 space-y-2">
          {artifacts.map((artifact) => (
            <div
              key={`${artifact.sessionId}:${artifact.fileName}`}
              className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/25 px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] text-gray-200">{artifact.fileName}</p>
                <p className="text-[10px] text-gray-500 truncate">{artifact.sessionId}</p>
              </div>
              <button
                type="button"
                onClick={() => onOpenArtifact?.(artifact)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[12px] text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantMetaInline({
  message,
  processActivities,
  sessionId,
  turnStartedAtMs,
  onOpenArtifact,
  section = "work",
  workspaceDir,
}: {
  message: ChatMessage;
  processActivities?: LiveActivityItem[];
  sessionId?: string | null;
  turnStartedAtMs?: number;
  onOpenArtifact?: (artifact: ArtifactSummaryView) => void;
  section?: "work" | "summary";
  workspaceDir?: string | null;
}) {
  const { t } = useI18n();
  const isWorkSection = section === "work";
  const orderedToolCalls = getToolCallsInTimelineOrder(message.tool_calls);
  const fileChangeSummary = summarizeMessageFileChanges(orderedToolCalls);
  const hasFileChangeSummary = !!fileChangeSummary;
  const artifactSummary = collectMessageArtifacts(orderedToolCalls, sessionId);
  const hasArtifacts = artifactSummary.length > 0;
  const workedDurationMs = resolveWorkedDurationMs(processActivities, message.tool_calls, {
    assistantTimestamp: message.timestamp,
    turnStartedAtMs,
  });
  const normalizedProcessActivities =
    processActivities && processActivities.length > 0
      ? finalizeCompletedActivities(processActivities)
      : [];
  const hasPersistedThoughtActivities = normalizedProcessActivities.some(
    (activity) => activity.toolName === "__thought"
  );
  const inferredThoughtActivities = !hasPersistedThoughtActivities
    ? inferThoughtActivitiesFromContent(
        message.content,
        parseTimestampMs(message.timestamp) ?? turnStartedAtMs
      )
    : [];
  const inferredThinkingActivities =
    !hasPersistedThoughtActivities && inferredThoughtActivities.length === 0
      ? inferThoughtActivitiesFromThinking(
          message.thinking,
          parseTimestampMs(message.timestamp) ?? turnStartedAtMs
        )
      : [];
  const contentAndThinkingActivities = mergeActivityLists(
    inferredThoughtActivities,
    inferredThinkingActivities
  );
  const workActivities = mergeActivityLists(
    normalizedProcessActivities,
    contentAndThinkingActivities
  );
  const sandboxProviderByToolCallId = new Map<string, string>();
  for (const toolCall of orderedToolCalls) {
    const toolCallId = typeof toolCall.id === "string" ? toolCall.id.trim().toLowerCase() : "";
    if (!toolCallId) continue;
    const sandboxProvider = resolveToolCallSandboxProvider(toolCall);
    if (!sandboxProvider) continue;
    sandboxProviderByToolCallId.set(toolCallId, sandboxProvider);
  }
  const workActivitiesWithSandbox = workActivities.map((activity) => {
    if (activity.sandboxProvider) return activity;
    const toolCallId =
      typeof activity.toolCallId === "string" ? activity.toolCallId.trim().toLowerCase() : "";
    if (!toolCallId) return activity;
    const sandboxProvider = sandboxProviderByToolCallId.get(toolCallId);
    if (!sandboxProvider) return activity;
    return {
      ...activity,
      sandboxProvider,
    };
  });
  const hasWorkSectionContent = workActivities.length > 0;
  const hasSummarySectionContent = hasFileChangeSummary || hasArtifacts;

  if ((isWorkSection && !hasWorkSectionContent) || (!isWorkSection && !hasSummarySectionContent)) {
    return null;
  }

  return (
    <div className={cn("space-y-2", isWorkSection ? "mb-3" : "mt-3")}>
      {isWorkSection && (
        <div className="text-[12px] text-gray-500 px-0.5">
          <span>
            {t("chat.workedFor", {
              duration:
                workedDurationMs !== undefined
                  ? formatWorkedDuration(workedDurationMs)
                  : "0h 00m 00s",
            })}
          </span>
        </div>
      )}

      {isWorkSection && workActivitiesWithSandbox.length > 0 && (
        <ProcessActivityList activities={workActivitiesWithSandbox} />
      )}

      {!isWorkSection && hasFileChangeSummary && fileChangeSummary && (
        <FileChangesCard summary={fileChangeSummary} workspaceDir={workspaceDir} />
      )}
      {!isWorkSection && hasArtifacts && (
        <ArtifactSummaryCard artifacts={artifactSummary} onOpenArtifact={onOpenArtifact} />
      )}
    </div>
  );
}

export function Chat() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: agents = [] } = useAgentSummaries();
  const stopAgent = useStopAgent();
  const updateAgentReasoning = useUpdateAgentReasoning();
  const { data: info } = useInfo();
  const [initialChatRoute] = useState(() => parseInitialChatRoute(window.location.search));
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    initialChatRoute.agentId ?? undefined
  );
  const [sessionAgentId, setSessionAgentId] = useState<string | null>(null);
  const [modelRouterEnabled, setModelRouterEnabled] = useState(false);
  const [useModelRouter, setUseModelRouter] = useState(false);
  const [lastWorkspaceDir, setLastWorkspaceDir] = useState<string | null>(null);
  const chatAgentId = useModelRouter
    ? selectedAgentId || sessionAgentId || undefined
    : selectedAgentId;
  const {
    messages,
    isLoading,
    sendMessage,
    stopGenerating,
    clearChat,
    loadSession,
    sessionId,
    workspaceDir,
    setWorkspaceDir,
    revertToMessage,
  } = useChat(chatAgentId, { useModelRouter });
  const { data: environmentSubagents = [] } = useSubagents(sessionId);
  const typedMessages = messages as ChatMessage[];
  const turnStartedAtMsByIndex = useMemo(() => {
    const lookup = new Map<number, number | undefined>();
    let latestUserTimestampMs: number | undefined;
    for (let index = 0; index < typedMessages.length; index += 1) {
      const message = typedMessages[index];
      lookup.set(index, latestUserTimestampMs);
      if (message?.role === "user") {
        const timestampMs = parseTimestampMs(message.timestamp);
        if (typeof timestampMs === "number") {
          latestUserTimestampMs = timestampMs;
        }
      }
    }
    return lookup;
  }, [typedMessages]);
  const visibleMessageEntries = useMemo(
    () =>
      typedMessages
        .map((message, originalIndex) => ({
          message,
          originalIndex,
          turnStartedAtMs: turnStartedAtMsByIndex.get(originalIndex),
        }))
        .filter((entry) => entry.message.role !== "system"),
    [typedMessages, turnStartedAtMsByIndex]
  );
  const loadSessionMutation = useLoadSession();
  const updateSessionAgent = useUpdateSessionAgent();
  const refreshSessionMessagesRef = useRef<(sid: string) => Promise<boolean>>(() =>
    Promise.resolve(false)
  );
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFileAttachment[]>([]);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [imageLightbox, setImageLightbox] = useState<{
    images: ChatLightboxImage[];
    index: number;
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [forkingMessageIndex, setForkingMessageIndex] = useState<number | null>(null);
  const [savingGoldenMessageIndex, setSavingGoldenMessageIndex] = useState<number | null>(null);
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState<number | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const copiedMessageTimerRef = useRef<number | null>(null);
  const handleCopyMessage = useCallback(async (index: number, content: string) => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch (error) {
        console.error("Failed to copy message:", error);
      }
    }
    if (!copied) return;
    setCopiedMessageIndex(index);
    if (copiedMessageTimerRef.current !== null) {
      window.clearTimeout(copiedMessageTimerRef.current);
    }
    copiedMessageTimerRef.current = window.setTimeout(() => {
      setCopiedMessageIndex(null);
      copiedMessageTimerRef.current = null;
    }, 1500);
  }, []);
  const handleReadAloud = useCallback(
    async (index: number, content: string) => {
      const activeAudio = speechAudioRef.current;
      if (activeAudio) {
        activeAudio.pause();
        speechAudioRef.current = null;
        setSpeakingMessageIndex(null);
        if (speakingMessageIndex === index) return;
      }
      try {
        setSpeakingMessageIndex(index);
        const result = await chatApi.synthesizeSpeech({ text: content });
        if (!result.success || !result.data?.audioPath) {
          throw new Error(result.error || "Speech synthesis failed");
        }
        const mediaUrl = appendApiTokenParam(
          `/api/media?path=${encodeURIComponent(result.data.audioPath)}`
        );
        const audio = new Audio(mediaUrl);
        speechAudioRef.current = audio;
        const clear = () => {
          if (speechAudioRef.current === audio) speechAudioRef.current = null;
          setSpeakingMessageIndex(null);
        };
        audio.addEventListener("ended", clear, { once: true });
        audio.addEventListener("error", clear, { once: true });
        await audio.play();
      } catch (error) {
        speechAudioRef.current = null;
        setSpeakingMessageIndex(null);
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Speech synthesis failed");
      }
    },
    [speakingMessageIndex]
  );
  const [reverting, setReverting] = useState(false);
  const [showSessionsPanel, setShowSessionsPanel] = useState(true);
  const [showWorkspacePanel, setShowWorkspacePanel] = useState(false);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTabInstance[]>([]);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<string | null>(null);
  const workspaceTabIdRef = useRef(0);
  const activeWorkspaceKind = useMemo(
    () => workspaceTabs.find((instance) => instance.id === activeWorkspaceTab)?.kind ?? null,
    [workspaceTabs, activeWorkspaceTab]
  );
  useEffect(() => {
    if (!showWorkspacePanel || workspaceTabs.length === 0) return;
    if (workspaceTabs.some((instance) => instance.id === activeWorkspaceTab)) return;
    setActiveWorkspaceTab(workspaceTabs[0].id);
  }, [activeWorkspaceTab, showWorkspacePanel, workspaceTabs]);
  const [showEnvironmentOverview, setShowEnvironmentOverview] = useState(false);
  const [hiddenComposerPlanKey, setHiddenComposerPlanKey] = useState<string | null>(null);
  const [diffPanelWidth, setDiffPanelWidth] = useState<number>(() => readPersistedDiffPanelWidth());
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [activeSessionIds, setActiveSessionIds] = useState<string[]>([]);
  const [artifactViewerTarget, setArtifactViewerTarget] = useState<ArtifactSummaryView | null>(
    null
  );
  const [artifactViewerLoading, setArtifactViewerLoading] = useState(false);
  const [artifactViewerError, setArtifactViewerError] = useState<string | null>(null);
  const [artifactViewerContent, setArtifactViewerContent] = useState("");
  const [artifactViewerRawView, setArtifactViewerRawView] = useState(false);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"thinking" | "generating" | "compacting" | "idle">(
    "idle"
  );
  const [liveActivities, setLiveActivities] = useState<LiveActivityItem[]>([]);
  const [liveCurrentStep, setLiveCurrentStep] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<PendingChatMessage[]>([]);
  const [sessionContextUsage, setSessionContextUsage] = useState<SessionContextUsage | null>(null);
  const [sessionTokenUsage, setSessionTokenUsage] = useState<SessionTokenUsage | null>(null);
  const [timeToFirstTokenMs, setTimeToFirstTokenMs] = useState<number | null>(null);
  const ttftStartRef = useRef<number | null>(null);
  const [steeringMessageId, setSteeringMessageId] = useState<string | null>(null);
  const [pendingMessageMutationId, setPendingMessageMutationId] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [dictationMode, setDictationMode] = useState<DictationMode>("auto");
  const [dictationLanguage, setDictationLanguage] = useState("en-US");
  const [dictationCapabilities, setDictationCapabilities] = useState<DictationRuntimeCapabilities>({
    nativeRecognition: false,
    nativeRecorder: false,
    mediaRecorder: false,
    microphone: false,
  });
  const [dictating, setDictating] = useState(false);
  const [dictationTranscribing, setDictationTranscribing] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<string | null>(null);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [toolApprovalMode, setToolApprovalMode] = useState<ToolApprovalMode>("always_allow");
  const [followUpBehaviorEnabled, setFollowUpBehaviorEnabled] = useState(true);
  const [savingToolApprovalMode, setSavingToolApprovalMode] = useState(false);
  const [providerPlanStatus, setProviderPlanStatus] = useState<ProviderPlanStatusResponse | null>(
    null
  );
  const [composerHeight, setComposerHeight] = useState(88);
  const [messageProcessMap, setMessageProcessMap] = useState<Record<string, LiveActivityItem[]>>(
    () => readPersistedMessageProcessMap()
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const nativeRecorderActiveRef = useRef(false);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationChunksRef = useRef<Blob[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const openChatImage = useCallback((src: string, alt: string) => {
    const nodes = Array.from(
      messagesContainerRef.current?.querySelectorAll<HTMLElement>("[data-chat-lightbox-src]") ?? []
    );
    const images = nodes
      .map((node) => ({
        src: node.dataset.chatLightboxSrc?.trim() || "",
        alt: node.dataset.chatLightboxAlt?.trim() || "Image",
      }))
      .filter((image) => image.src.length > 0);
    const index = Math.max(
      0,
      images.findIndex((image) => image.src === src && image.alt === alt)
    );
    setImageLightbox({ images: images.length > 0 ? images : [{ src, alt }], index });
  }, []);
  const keepScrolledToBottomRef = useRef(true);
  const programmaticScrollUntilRef = useRef(0);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const diffPanelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const diffPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  const dictationStatusTimerRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const restoreSessionGenerationRef = useRef(0);
  const suppressAutoRestoreRef = useRef(false);
  const loadingRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const optimisticPendingMessageCounterRef = useRef(0);
  const acceptEventsUntilRef = useRef(0);
  const runStartSyncedSessionsRef = useRef<Set<string>>(new Set());
  const pendingProcessCaptureRef = useRef<PendingProcessCapture | null>(null);
  const runActivityBufferRef = useRef<LiveActivityItem[]>([]);
  const liveActivitiesRef = useRef<LiveActivityItem[]>([]);
  const latestStatusTimestampBySessionRef = useRef<Record<string, number>>({});
  const stoppedSessionUntilRef = useRef<Record<string, number>>({});
  const configuredWorkspaceDir =
    typeof info?.defaultWorkspaceDir === "string" && info.defaultWorkspaceDir.trim().length > 0
      ? info.defaultWorkspaceDir.trim()
      : null;
  const homeWorkspaceDir =
    typeof info?.homeDir === "string" && info.homeDir.trim().length > 0
      ? info.homeDir.trim()
      : null;
  const fallbackWorkspaceDir =
    !sessionId && (lastWorkspaceDir || configuredWorkspaceDir || homeWorkspaceDir)
      ? lastWorkspaceDir || configuredWorkspaceDir || homeWorkspaceDir
      : null;
  const effectiveWorkspaceDir = workspaceDir || fallbackWorkspaceDir || null;
  const markSessionStopped = useCallback((targetSessionId?: string | null) => {
    const key =
      typeof targetSessionId === "string" && targetSessionId.trim().length > 0
        ? targetSessionId.trim()
        : null;
    if (!key) return;
    stoppedSessionUntilRef.current[key] = Date.now() + STOPPED_SESSION_STATUS_SUPPRESSION_MS;
  }, []);
  const isSessionStopSuppressed = useCallback((targetSessionId?: string | null) => {
    const key =
      typeof targetSessionId === "string" && targetSessionId.trim().length > 0
        ? targetSessionId.trim()
        : null;
    if (!key) return false;
    const until = stoppedSessionUntilRef.current[key] || 0;
    if (until <= Date.now()) {
      delete stoppedSessionUntilRef.current[key];
      return false;
    }
    return true;
  }, []);
  const {
    summary: sessionFileChanges,
    loading: sessionFileChangesLoading,
    error: sessionFileChangesError,
    refresh: refreshSessionFileChanges,
  } = useSessionFileChanges(
    sessionId,
    typedMessages,
    liveActivities,
    showWorkspacePanel && activeWorkspaceKind === "review"
  );
  const openWorkspaceTab = useCallback((kind: ChatWorkspaceTab) => {
    setShowWorkspacePanel(true);
    setShowEnvironmentOverview(false);
    setWorkspaceTabs((current) => {
      if (WORKSPACE_SINGLETON_KINDS.has(kind)) {
        const existing = current.find((instance) => instance.kind === kind);
        if (existing) {
          setActiveWorkspaceTab(existing.id);
          return current;
        }
      }
      const id = `${kind}-${(workspaceTabIdRef.current += 1)}`;
      const pageKey =
        kind === "browser" && current.some((instance) => instance.kind === "browser")
          ? id
          : undefined;
      setActiveWorkspaceTab(id);
      return [...current, { id, kind, pageKey }];
    });
  }, []);
  const toggleWorkspaceTab = useCallback(
    (kind: ChatWorkspaceTab) => {
      const activeKind = workspaceTabs.find((instance) => instance.id === activeWorkspaceTab)?.kind;
      if (showWorkspacePanel && activeKind === kind) {
        setShowWorkspacePanel(false);
        return;
      }
      openWorkspaceTab(kind);
    },
    [showWorkspacePanel, activeWorkspaceTab, workspaceTabs, openWorkspaceTab]
  );
  const closeWorkspaceTab = useCallback((id: string) => {
    setWorkspaceTabs((current) => {
      const index = current.findIndex((instance) => instance.id === id);
      if (index === -1) return current;
      const next = current.filter((instance) => instance.id !== id);
      setActiveWorkspaceTab((prev) =>
        prev === id ? (next[Math.min(index, next.length - 1)]?.id ?? null) : prev
      );
      return next;
    });
  }, []);
  const updateWorkspaceTabTitle = useCallback((id: string, title: string) => {
    setWorkspaceTabs((current) =>
      current.map((instance) => (instance.id === id ? { ...instance, title } : instance))
    );
  }, []);
  const currentSessionPlan = useMemo(
    () => extractLatestPlanFromMessages(typedMessages, sessionId),
    [typedMessages, sessionId]
  );
  const currentSessionPlanKey = useMemo(() => {
    if (!currentSessionPlan) return null;
    return [
      sessionId || "new-chat",
      currentSessionPlan.updatedAt || "",
      currentSessionPlan.summary.completed,
      currentSessionPlan.summary.inProgress,
      currentSessionPlan.summary.pending,
      currentSessionPlan.summary.total,
      currentSessionPlan.items.map((item) => `${item.status}:${item.content}`).join("|"),
    ].join(":");
  }, [currentSessionPlan, sessionId]);
  const showComposerPlan =
    !!currentSessionPlan &&
    !isSessionPlanComplete(currentSessionPlan) &&
    currentSessionPlanKey !== hiddenComposerPlanKey;
  const [dismissedEnvironmentPlanKey, setDismissedEnvironmentPlanKey] = useState<string | null>(
    null
  );
  const environmentPlan =
    currentSessionPlanKey && currentSessionPlanKey === dismissedEnvironmentPlanKey
      ? null
      : currentSessionPlan;
  const dismissEnvironmentPlan = useCallback(() => {
    if (currentSessionPlanKey) setDismissedEnvironmentPlanKey(currentSessionPlanKey);
  }, [currentSessionPlanKey]);
  const environmentToolNames = useMemo(() => {
    const names = new Set<string>();
    for (const message of typedMessages) {
      for (const toolCall of message.tool_calls || []) {
        if (toolCall.name.trim().length > 0) {
          names.add(toolCall.name);
        }
      }
    }
    return Array.from(names).slice(0, 24);
  }, [typedMessages]);
  const agentUsingBrowser = useMemo(() => {
    const sessionActive = !!sessionId && activeSessionIds.includes(sessionId);
    return isAgentUsingBrowser(liveActivities, sessionActive);
  }, [activeSessionIds, liveActivities, sessionId]);
  const resolveSelectableSessionAgentId = useCallback(
    (agentId?: string | null): string | undefined => {
      if (typeof agentId !== "string") return undefined;
      const trimmed = agentId.trim();
      if (!trimmed || trimmed === "default") return undefined;
      return agents.some((agent) => agent.id === trimmed) ? trimmed : undefined;
    },
    [agents]
  );
  const dictationRuntime = useMemo(
    () => resolveDictationRuntime(dictationMode, dictationCapabilities),
    [dictationCapabilities, dictationMode]
  );
  const activeAgentForPlan = useMemo(
    () => agents.find((agent) => agent.id === (selectedAgentId || sessionAgentId || "")) ?? null,
    [agents, selectedAgentId, sessionAgentId]
  );
  const activeProviderPlan = useMemo(() => {
    if (useModelRouter) return null;
    if (!providerPlanStatus || !activeAgentForPlan) return null;
    const keys = new Set(
      [
        activeAgentForPlan.provider_id,
        activeAgentForPlan.provider,
        activeAgentForPlan.fallback_provider_id,
      ].filter((value): value is string => typeof value === "string" && value.length > 0)
    );
    return (
      providerPlanStatus.providers.find((plan) =>
        [plan.configuredProviderId, plan.providerId, plan.providerType].some(
          (key) => typeof key === "string" && keys.has(key)
        )
      ) ?? null
    );
  }, [activeAgentForPlan, providerPlanStatus, useModelRouter]);
  const environmentGit = useEnvironmentGitBranches(effectiveWorkspaceDir);
  const syncSessionAgentSelection = useCallback(
    (agentId?: string | null) => {
      const normalized = typeof agentId === "string" && agentId.trim() ? agentId.trim() : null;
      setSessionAgentId(normalized);
      setSelectedAgentId(resolveSelectableSessionAgentId(normalized));
    },
    [resolveSelectableSessionAgentId]
  );

  const handleForkSession = useCallback(
    async (messageIndex: number) => {
      if (!sessionId || forkingMessageIndex !== null) return;
      setForkingMessageIndex(messageIndex);
      try {
        const response = await chatApi.forkSession(sessionId, {
          throughMessageIndex: messageIndex,
        });
        if (!response.success || !response.data?.fork) {
          throw new Error(response.error || "Failed to fork chat");
        }
        const fork = response.data.fork;
        const detail = await loadSessionMutation.loadFresh(fork.sessionId);
        if (!detail?.messagesList) throw new Error("Forked chat could not be loaded");
        loadSession(fork.sessionId, detail.messagesList as ChatMessage[], fork.workspaceDir);
        syncSessionAgentSelection(fork.agentId);
        navigate(`/chat?session=${encodeURIComponent(fork.sessionId)}`, { replace: true });
        useUIStore.getState().addToast("success", "Forked chat from this point");
      } catch (error) {
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Failed to fork chat");
      } finally {
        setForkingMessageIndex(null);
      }
    },
    [
      forkingMessageIndex,
      loadSession,
      loadSessionMutation,
      navigate,
      sessionId,
      syncSessionAgentSelection,
    ]
  );

  const handleSaveGolden = useCallback(
    async (messageIndex: number) => {
      if (!sessionId || savingGoldenMessageIndex !== null) return;
      setSavingGoldenMessageIndex(messageIndex);
      try {
        const response = await chatApi.saveGolden(sessionId, { messageIndex });
        if (!response.success || !response.data?.golden) {
          throw new Error(response.error || "Failed to save golden test");
        }
        void queryClient.invalidateQueries({ queryKey: ["agent-evals"] });
        useUIStore.getState().addToast("success", "Saved turn as a golden test");
      } catch (error) {
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Failed to save golden test");
      } finally {
        setSavingGoldenMessageIndex(null);
      }
    },
    [queryClient, savingGoldenMessageIndex, sessionId]
  );

  useEffect(() => {
    setLastWorkspaceDir(readPersistedWorkspaceDir());
  }, []);

  useEffect(() => {
    if (!workspaceDir) return;
    persistWorkspaceDir(workspaceDir);
    setLastWorkspaceDir(workspaceDir);
  }, [workspaceDir]);

  useEffect(() => {
    if (sessionId) {
      persistSessionId(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    const loadRouterConfig = async () => {
      try {
        const response = await apiFetch("/api/router/config");
        if (!active) return;
        const data = await response.json();
        setModelRouterEnabled(data?.enabled === true);
        if (data?.enabled !== true) {
          setUseModelRouter(false);
        }
      } catch {
        if (active) {
          setModelRouterEnabled(false);
          setUseModelRouter(false);
        }
      }
    };
    const loadProviderPlans = async () => {
      const response = await providerPlansApi.status();
      if (!active) return;
      setProviderPlanStatus(response.success ? (response.data ?? null) : null);
    };
    void loadRouterConfig();
    void loadProviderPlans();
    const interval = window.setInterval(loadProviderPlans, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setShowSessionsPanel(true);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionAgentId) return;
    const nextSelected = resolveSelectableSessionAgentId(sessionAgentId);
    if (!nextSelected) return;
    if (selectedAgentId === nextSelected) return;
    setSelectedAgentId(nextSelected);
  }, [resolveSelectableSessionAgentId, selectedAgentId, sessionAgentId]);

  const handleSelectAgent = useCallback(
    async (agentId?: string) => {
      if (agentId === MODEL_ROUTER_SELECTOR_VALUE) {
        if (!modelRouterEnabled) return;
        setUseModelRouter(true);
        setSessionContextUsage(null);
        setSessionTokenUsage(null);
        return;
      }
      const previousSelectedAgentId = selectedAgentId;
      const previousSessionAgentId = sessionAgentId;
      const nextAgentId = resolveSelectableSessionAgentId(agentId);
      setUseModelRouter(false);
      setSelectedAgentId(nextAgentId);
      setSessionAgentId(nextAgentId ?? null);

      if (!nextAgentId) {
        if (sessionId) {
          setSelectedAgentId(previousSelectedAgentId);
          setSessionAgentId(previousSessionAgentId);
          return;
        }
        setSessionAgentId(null);
        setSessionContextUsage(null);
        setSessionTokenUsage(null);
        return;
      }

      if (!sessionId) {
        setSessionAgentId(nextAgentId);
        setSessionContextUsage(null);
        setSessionTokenUsage(null);
        return;
      }

      try {
        const updated = await updateSessionAgent.mutateAsync({
          sessionId,
          agentId: nextAgentId,
        });
        syncSessionAgentSelection(updated.agentId);
        setSessionContextUsage(updated.contextUsage ?? null);
        setSessionTokenUsage(updated.tokenUsage ?? null);
      } catch (error) {
        setSelectedAgentId(previousSelectedAgentId);
        setSessionAgentId(previousSessionAgentId);
        console.error("Failed to update session agent:", error);
      }
    },
    [
      resolveSelectableSessionAgentId,
      modelRouterEnabled,
      selectedAgentId,
      sessionAgentId,
      sessionId,
      syncSessionAgentSelection,
      updateSessionAgent,
    ]
  );

  const updateToolApprovalMode = useCallback(
    async (nextMode: ToolApprovalMode) => {
      if (nextMode === toolApprovalMode || savingToolApprovalMode) return;
      const previousMode = toolApprovalMode;
      setToolApprovalMode(nextMode);
      setSavingToolApprovalMode(true);
      try {
        const result = await settingsApi.updateConfig({ tool_approval_mode: nextMode });
        if (!result.success || !result.data?.success) {
          throw new Error(result.error || "Config update failed");
        }
        useUIStore
          .getState()
          .addToast(
            "success",
            nextMode === "ask"
              ? "Tool approvals set to Ask Me"
              : "Tool approvals set to Always Allow"
          );
      } catch (error) {
        setToolApprovalMode(previousMode);
        useUIStore
          .getState()
          .addToast(
            "error",
            error instanceof Error ? error.message : "Failed to update tool approval mode"
          );
      } finally {
        setSavingToolApprovalMode(false);
      }
    },
    [savingToolApprovalMode, toolApprovalMode]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      setDictationCapabilities({
        nativeRecognition: false,
        nativeRecorder: false,
        mediaRecorder: false,
        microphone: false,
      });
      return;
    }
    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    setDictationCapabilities({
      nativeRecognition: canUseNativeSpeechRecognition(!!SpeechCtor, isTauriDesktopRuntime()),
      nativeRecorder: isTauriDesktopRuntime(),
      mediaRecorder: typeof window.MediaRecorder !== "undefined",
      microphone: !!window.navigator?.mediaDevices?.getUserMedia,
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadSpeechSettings = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        const speech =
          result.data?.speech && typeof result.data.speech === "object"
            ? (result.data.speech as Record<string, unknown>)
            : {};
        const stt =
          speech.stt && typeof speech.stt === "object"
            ? (speech.stt as Record<string, unknown>)
            : {};
        setToolApprovalMode(normalizeToolApprovalMode(result.data?.tool_approval_mode));
        setFollowUpBehaviorEnabled(result.data?.follow_up_behavior_enabled !== false);
        setDictationMode(normalizeDictationMode(stt.provider));
        setDictationLanguage(
          typeof stt.language === "string" && stt.language.trim() ? stt.language.trim() : "en-US"
        );
      } catch {
        if (mounted) {
          setDictationMode("auto");
          setDictationLanguage("en-US");
        }
      }
    };
    void loadSpeechSettings();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      diffPanelResizeCleanupRef.current?.();
      diffPanelResizeCleanupRef.current = null;
      if (dictationStatusTimerRef.current !== null) {
        window.clearTimeout(dictationStatusTimerRef.current);
        dictationStatusTimerRef.current = null;
      }
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (nativeRecorderActiveRef.current) void stopNativeAudioRecording().catch(() => undefined);
      if (dictationStreamRef.current) {
        for (const track of dictationStreamRef.current.getTracks()) {
          track.stop();
        }
        dictationStreamRef.current = null;
      }
      speechAudioRef.current?.pause();
      speechAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    persistMessageProcessMap(messageProcessMap);
  }, [messageProcessMap]);

  useEffect(() => {
    persistDiffPanelWidth(diffPanelWidth);
  }, [diffPanelWidth]);

  useEffect(() => {
    if (!sessionId || typedMessages.length === 0) return;
    setMessageProcessMap((previous) => {
      let changed = false;
      const next: Record<string, LiveActivityItem[]> = { ...previous };
      for (let index = 0; index < typedMessages.length; index += 1) {
        const message = typedMessages[index];
        if (!message || message.role !== "assistant") continue;
        const canonicalKey = getMessageProcessKey(sessionId, message, index);
        if (Array.isArray(next[canonicalKey]) && next[canonicalKey].length > 0) {
          continue;
        }
        const legacyKey = getLegacyMessageProcessKey(sessionId, message, index);
        const legacy = next[legacyKey];
        if (!Array.isArray(legacy) || legacy.length === 0) continue;
        next[canonicalKey] = legacy.map((activity) => ({ ...activity }));
        changed = true;
        continue;
      }

      for (let index = 0; index < typedMessages.length; index += 1) {
        const message = typedMessages[index];
        if (!message || message.role !== "assistant") continue;
        const canonicalKey = getMessageProcessKey(sessionId, message, index);
        if (Array.isArray(next[canonicalKey]) && next[canonicalKey].length > 0) {
          continue;
        }
        const messageTimestampMs = parseTimestampMs(message.timestamp);
        const turnStartedAtMs = turnStartedAtMsByIndex.get(index);
        const embedded = normalizeMessageProcessActivities(
          message.process_activities,
          messageTimestampMs ?? turnStartedAtMs
        );
        if (embedded.length === 0) continue;
        next[canonicalKey] = embedded;
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [sessionId, typedMessages, turnStartedAtMsByIndex]);

  useEffect(() => {
    if (!sessionFileChanges || sessionFileChanges.files.length === 0) {
      if (selectedDiffPath !== null) {
        setSelectedDiffPath(null);
      }
      return;
    }

    if (
      selectedDiffPath &&
      sessionFileChanges.files.some((file) => file.path === selectedDiffPath)
    ) {
      return;
    }

    setSelectedDiffPath(sessionFileChanges.files[0]?.path || null);
  }, [selectedDiffPath, sessionFileChanges]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = messagesContainerRef.current;
    if (!container) return;
    keepScrolledToBottomRef.current = true;
    if (behavior === "smooth") {
      programmaticScrollUntilRef.current = Number.POSITIVE_INFINITY;
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
      programmaticScrollTimeoutRef.current = window.setTimeout(() => {
        programmaticScrollTimeoutRef.current = null;
        programmaticScrollUntilRef.current = 0;
        const latestContainer = messagesContainerRef.current;
        if (!latestContainer || isChatNearBottom(latestContainer)) return;
        keepScrolledToBottomRef.current = false;
        setShowScrollToBottomButton(true);
      }, 2500);
    } else if (programmaticScrollUntilRef.current !== Number.POSITIVE_INFINITY) {
      programmaticScrollUntilRef.current = performance.now() + 100;
    }
    container.scrollTo({ top: container.scrollHeight, behavior });
    setShowScrollToBottomButton(false);
  }, []);

  const refreshScrollToBottomVisibility = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || artifactViewerTarget) {
      setShowScrollToBottomButton(false);
      return;
    }
    const nearBottom = isChatNearBottom(container);
    const programmaticScrollActive = performance.now() < programmaticScrollUntilRef.current;
    if (nearBottom) {
      keepScrolledToBottomRef.current = true;
      programmaticScrollUntilRef.current = 0;
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
        programmaticScrollTimeoutRef.current = null;
      }
    } else if (!programmaticScrollActive) {
      keepScrolledToBottomRef.current = false;
    }
    setShowScrollToBottomButton(!nearBottom && !programmaticScrollActive);
  }, [artifactViewerTarget]);

  useEffect(
    () => () => {
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (artifactViewerTarget) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    if (!keepScrolledToBottomRef.current && !isChatNearBottom(container, 96)) return;
    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [liveActivities, streamingContent, liveCurrentStep, artifactViewerTarget, scrollToBottom]);

  useEffect(() => {
    if (artifactViewerTarget || typeof ResizeObserver === "undefined") return;
    const container = messagesContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (keepScrolledToBottomRef.current) {
          scrollToBottom("auto");
        } else {
          refreshScrollToBottomVisibility();
        }
      });
    });
    observer.observe(container);
    const observeChildren = () => {
      for (const child of container.children) observer.observe(child);
    };
    observeChildren();
    const mutationObserver = new MutationObserver(observeChildren);
    mutationObserver.observe(container, { childList: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [artifactViewerTarget, refreshScrollToBottomVisibility, scrollToBottom]);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      refreshScrollToBottomVisibility();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [refreshScrollToBottomVisibility, typedMessages.length, isLoading, artifactViewerTarget]);

  useEffect(() => {
    activeSessionRef.current = sessionId;
    loadingRef.current = isLoading;
  }, [sessionId, isLoading]);

  useEffect(() => {
    const assistantCount = typedMessages.reduce(
      (count, message) => count + (message.role === "assistant" ? 1 : 0),
      0
    );

    if (isLoading && !wasLoadingRef.current) {
      setLoadingSessionId(sessionId ?? null);
      runActivityBufferRef.current = [];
      setLiveActivities([]);
      setLiveStatus("thinking");
      setLiveCurrentStep("Thinking...");
      acceptEventsUntilRef.current = 0;
      pendingProcessCaptureRef.current = {
        assistantCountBefore: assistantCount,
        activities: [],
        sessionId,
        agentId: selectedAgentId,
        createdAt: Date.now(),
      };
    }

    if (!isLoading && wasLoadingRef.current) {
      setLoadingSessionId(null);
      acceptEventsUntilRef.current = Date.now() + 1500;
      const pendingActivities = pendingProcessCaptureRef.current?.activities || [];
      const runActivities = mergeActivityLists(
        mergeActivityLists(pendingActivities, runActivityBufferRef.current),
        liveActivities
      );
      if (pendingProcessCaptureRef.current) {
        pendingProcessCaptureRef.current = {
          ...pendingProcessCaptureRef.current,
          activities: runActivities.map((activity) => ({ ...activity })),
          createdAt: Date.now(),
        };
      } else if (runActivities.length > 0) {
        pendingProcessCaptureRef.current = {
          assistantCountBefore: assistantCount,
          activities: runActivities.map((activity) => ({ ...activity })),
          sessionId,
          agentId: selectedAgentId,
          createdAt: Date.now(),
        };
      }
    }

    wasLoadingRef.current = isLoading;
  }, [isLoading, liveActivities, sessionId, selectedAgentId, typedMessages]);

  useEffect(() => {
    const pending = pendingProcessCaptureRef.current;
    if (!pending) return;

    if (!isLoading && Date.now() - pending.createdAt > PENDING_CAPTURE_TIMEOUT_MS) {
      pendingProcessCaptureRef.current = null;
      return;
    }

    const sessionMismatch = !!pending.sessionId && !!sessionId && pending.sessionId !== sessionId;
    if (sessionMismatch) {
      pendingProcessCaptureRef.current = null;
      return;
    }

    const assistantEntries = typedMessages
      .map((message, index) => ({ message, index }))
      .filter((entry) => entry.message.role === "assistant");

    let target =
      assistantEntries.length > pending.assistantCountBefore
        ? assistantEntries[pending.assistantCountBefore]
        : undefined;
    if (!target && !isLoading && assistantEntries.length > 0) {
      const cutoffTimestamp = pending.createdAt - 5000;
      target =
        assistantEntries.find((entry) => {
          const messageTimestamp = parseTimestampMs(entry.message.timestamp);
          return typeof messageTimestamp === "number" && messageTimestamp >= cutoffTimestamp;
        }) || assistantEntries[assistantEntries.length - 1];
    }
    if (!target) {
      return;
    }

    const processKey = getMessageProcessKey(sessionId, target.message, target.index);
    const legacyProcessKey = getLegacyMessageProcessKey(sessionId, target.message, target.index);
    const targetTurnStartedAtMs = turnStartedAtMsByIndex.get(target.index);
    const embeddedActivities = normalizeMessageProcessActivities(
      target.message.process_activities,
      parseTimestampMs(target.message.timestamp) ?? targetTurnStartedAtMs
    );
    const captureActivities = suppressRecoveredWebFailureActivities(
      mergeActivityLists(
        mergeActivityLists(pending.activities, runActivityBufferRef.current),
        liveActivities
      ),
      target.message.tool_calls
    );
    const fallbackToolActivities =
      embeddedActivities.length === 0
        ? buildActivitiesFromToolCalls(target.message.tool_calls, formatToolIntent, {
            baseTimestampMs:
              parseTimestampMs(target.message.timestamp) ?? targetTurnStartedAtMs ?? 0,
          })
        : [];
    const mergedActivities =
      embeddedActivities.length > 0
        ? mergeActivityLists(captureActivities, embeddedActivities)
        : mergeActivityLists(captureActivities, fallbackToolActivities);
    const finalizedActivities = finalizeCompletedActivities(mergedActivities);

    if (finalizedActivities.length > 0) {
      setMessageProcessMap((previous) => {
        const next: Record<string, LiveActivityItem[]> = {
          ...previous,
          [processKey]: finalizedActivities,
        };
        if (legacyProcessKey in next && legacyProcessKey !== processKey) {
          delete next[legacyProcessKey];
        }
        return next;
      });
    }

    pendingProcessCaptureRef.current = null;
    runActivityBufferRef.current = [];
    setLiveActivities([]);
    setLiveCurrentStep(null);
  }, [isLoading, liveActivities, sessionId, typedMessages, turnStartedAtMsByIndex]);

  const markFirstTokenLatency = useCallback((forSessionId?: string | null) => {
    if (ttftStartRef.current === null) return;
    if (forSessionId && activeSessionRef.current && forSessionId !== activeSessionRef.current) {
      return;
    }
    const elapsed = Math.round(performance.now() - ttftStartRef.current);
    ttftStartRef.current = null;
    setTimeToFirstTokenMs(elapsed);
  }, []);

  const appendLiveActivity = useCallback(
    (
      phase: "start" | "result" | "error" | "blocked",
      text: string,
      toolName?: string,
      eventTimestamp?: number,
      toolCallId?: string,
      sandboxProvider?: string
    ) => {
      markFirstTokenLatency();

      const applyEvent = (previous: LiveActivityItem[]): LiveActivityItem[] =>
        applyLiveActivityEvent(previous, {
          phase,
          text,
          timestamp: eventTimestamp,
          toolName,
          toolCallId,
          sandboxProvider,
        });

      runActivityBufferRef.current = applyEvent(runActivityBufferRef.current);
      setLiveActivities((previous) => applyEvent(previous));
    },
    [markFirstTokenLatency]
  );

  const snapshotLatestTimestamp = useCallback((snapshot: LiveStatusSnapshotLike): number => {
    let latest =
      typeof snapshot.timestamp === "number" && Number.isFinite(snapshot.timestamp)
        ? snapshot.timestamp
        : 0;
    if (Array.isArray(snapshot.activities)) {
      for (const activity of snapshot.activities) {
        if (
          activity &&
          typeof activity.timestamp === "number" &&
          Number.isFinite(activity.timestamp) &&
          activity.timestamp > latest
        ) {
          latest = activity.timestamp;
        }
      }
    }
    return latest;
  }, []);

  const resolveSnapshotLiveState = useCallback(
    (snapshot: LiveStatusSnapshotLike, localActivities: LiveActivityItem[]) => {
      const normalizedStatus = normalizeSessionStatus(snapshot.status);
      const snapshotActivities = normalizeSnapshotActivities(
        mergeActivityLists([], toLiveActivityItems(snapshot.activities)),
        snapshot.status
      );
      const activities = resolveStatusSnapshotActivities(
        snapshotActivities,
        localActivities,
        normalizedStatus
      );
      const activeStep = getLatestInFlightStep(activities);
      let currentStep: string | null = null;
      if (activeStep && !isGenericStatusLabel(activeStep)) {
        currentStep = activeStep;
      } else {
        const detail = typeof snapshot.detail === "string" ? snapshot.detail.trim() : "";
        if (isMeaningfulThoughtDetail(detail)) {
          currentStep = detail;
        } else if (normalizedStatus === "generating") {
          currentStep = "Generating response...";
        } else if (normalizedStatus === "compacting") {
          currentStep = "Compacting earlier context...";
        } else if (normalizedStatus === "thinking") {
          currentStep = "Thinking...";
        }
      }
      return { status: normalizedStatus, activities, currentStep };
    },
    []
  );

  const cacheLiveStatusSnapshot = useCallback(
    (snapshot: LiveStatusSnapshotLike) => {
      const snapshotSessionId =
        typeof snapshot.sessionId === "string" && snapshot.sessionId.trim()
          ? snapshot.sessionId.trim()
          : null;
      if (!snapshotSessionId) return;
      const snapshotStatus = typeof snapshot.status === "string" ? snapshot.status : "";
      if (
        isSessionStopSuppressed(snapshotSessionId) &&
        snapshotStatus !== "idle" &&
        snapshotStatus !== "error"
      ) {
        return;
      }
      const cached = readCachedLiveSessionState(snapshotSessionId);
      const localActivities = cached?.activities || [];
      const next = resolveSnapshotLiveState(snapshot, localActivities);
      const latestTimestamp = snapshotLatestTimestamp(snapshot);
      if (latestTimestamp > 0) {
        const previousTimestamp = latestStatusTimestampBySessionRef.current[snapshotSessionId] || 0;
        if (latestTimestamp > previousTimestamp) {
          latestStatusTimestampBySessionRef.current[snapshotSessionId] = latestTimestamp;
        }
      }
      writeCachedLiveSessionState(snapshotSessionId, {
        status: next.status,
        activities: next.activities,
        currentStep: next.currentStep,
        streamingContent: cached?.streamingContent ?? null,
      });
    },
    [isSessionStopSuppressed, resolveSnapshotLiveState, snapshotLatestTimestamp]
  );

  const cacheAssistantToken = useCallback(
    (payload: StatusStreamTokenEvent) => {
      const tokenSessionId =
        typeof payload.sessionId === "string" && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : null;
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (!tokenSessionId || !delta) return;
      if (isSessionStopSuppressed(tokenSessionId)) return;
      markFirstTokenLatency(tokenSessionId);
      const cached = readCachedLiveSessionState(tokenSessionId);
      writeCachedLiveSessionState(tokenSessionId, {
        status: "generating",
        activities: cached?.activities || [],
        currentStep: cached?.currentStep || "Generating response...",
        streamingContent: `${cached?.streamingContent || ""}${delta}`,
      });
    },
    [isSessionStopSuppressed, markFirstTokenLatency]
  );

  const cacheLiveStatusEvent = useCallback(
    (payload: StatusStreamStatusEvent) => {
      const payloadSessionId =
        typeof payload.sessionId === "string" && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : null;
      if (!payloadSessionId) return;
      const status = typeof payload.status === "string" ? payload.status : "";
      if (!status) return;
      if (isSessionStopSuppressed(payloadSessionId) && status !== "idle" && status !== "error") {
        return;
      }
      const statusDetail = typeof payload.detail === "string" ? payload.detail.trim() : "";
      const isSteeringHandoff =
        status === "idle" && statusDetail.toLowerCase() === "steering to follow-up...";
      if (status === "error") {
        clearCachedLiveSessionState(payloadSessionId);
        return;
      }
      if (status === "idle" && !isSteeringHandoff) return;

      const cached = readCachedLiveSessionState(payloadSessionId);
      const eventTimestamp =
        typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
          ? payload.timestamp
          : undefined;
      let activities = cached?.activities || [];
      let currentStep = cached?.currentStep || null;
      const normalizedStatus = normalizeSessionStatus(status);

      if (status === "thinking" || status === "generating" || status === "compacting") {
        const activeToolStep = getLatestInFlightStep(activities);
        if (!payload.toolName) {
          const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
          if (status === "compacting") {
            currentStep = activeToolStep || detail || "Compacting earlier context...";
          } else if (isMeaningfulThoughtDetail(detail)) {
            const text = detail;
            activities = applyLiveActivityEvent(activities, {
              phase: "result",
              text,
              timestamp: eventTimestamp,
              toolName: "__thought",
            });
            currentStep = activeToolStep || text;
          } else {
            currentStep =
              activeToolStep ||
              (status === "generating"
                ? "Generating response..."
                : status === "thinking"
                  ? "Thinking..."
                  : null);
          }
        }
        writeCachedLiveSessionState(payloadSessionId, {
          status: normalizedStatus,
          activities,
          currentStep,
          streamingContent: cached?.streamingContent ?? null,
        });
        return;
      }

      if (isSteeringHandoff) {
        activities = applyLiveActivityEvent(activities, {
          phase: "result",
          text: statusDetail,
          timestamp: eventTimestamp,
          toolName: "__thought",
        });
        writeCachedLiveSessionState(payloadSessionId, {
          status: "thinking",
          activities,
          currentStep: statusDetail,
          streamingContent: cached?.streamingContent ?? null,
        });
        return;
      }

      if (status === "tool_executing" || status === "tool_completed") {
        const phase: "start" | "result" = status === "tool_executing" ? "start" : "result";
        const toolName = payload.toolName || "tool";
        const text = formatToolIntent(toolName, {}, phase, payload.detail);
        activities = applyLiveActivityEvent(activities, {
          phase,
          text,
          timestamp: eventTimestamp,
          toolName: payload.toolName,
          toolCallId: payload.toolCallId,
          sandboxProvider: payload.sandboxProvider,
        });
        writeCachedLiveSessionState(payloadSessionId, {
          status: phase === "start" ? "thinking" : normalizedStatus,
          activities,
          currentStep:
            phase === "start"
              ? isGenericStatusLabel(text)
                ? "Thinking..."
                : text
              : getLatestInFlightStep(activities),
          streamingContent: cached?.streamingContent ?? null,
        });
      }
    },
    [isSessionStopSuppressed]
  );

  const hydrateSessionStatus = useCallback(
    async (targetSessionId?: string | null) => {
      const resolvedSessionId =
        typeof targetSessionId === "string" && targetSessionId.trim().length > 0
          ? targetSessionId.trim()
          : null;

      try {
        const response = await chatApi.getSessionStatus(resolvedSessionId || undefined);
        if (!response.success || !response.data) return;
        const payload = response.data as SessionStatusResponse;
        const rawActiveIds = Array.isArray(payload.activeSessionIds)
          ? payload.activeSessionIds
          : [];
        const visibleActiveIds = rawActiveIds.filter(
          (candidateId) => !isSessionStopSuppressed(candidateId)
        );

        if (!resolvedSessionId) return;
        const snapshot = payload.session;
        const stopSuppressed = isSessionStopSuppressed(resolvedSessionId);
        const snapshotAgeMs =
          snapshot && typeof snapshot.timestamp === "number"
            ? Date.now() - snapshot.timestamp
            : Infinity;
        const snapshotFresh = snapshotAgeMs <= SESSION_ACTIVITY_STALE_MS;
        const nextActiveIds =
          snapshot && !snapshotFresh
            ? visibleActiveIds.filter((candidateId) => candidateId !== resolvedSessionId)
            : visibleActiveIds;
        setActiveSessionIds(nextActiveIds);
        if (stopSuppressed) {
          if (activeSessionRef.current === resolvedSessionId) {
            setLiveStatus("idle");
            setLiveActivities([]);
            liveActivitiesRef.current = [];
            setLiveCurrentStep(null);
            runActivityBufferRef.current = [];
          }
          clearCachedLiveSessionState(resolvedSessionId);
          return;
        }
        const isActive =
          !!snapshot &&
          snapshotFresh &&
          (payload.active === true ||
            snapshot.status === "thinking" ||
            snapshot.status === "generating" ||
            snapshot.status === "compacting" ||
            snapshot.status === "tool_executing" ||
            snapshot.status === "tool_completed");
        setPendingMessages((current) =>
          mergePendingChatMessages(snapshot?.pendingMessages, current)
        );
        if (snapshot && snapshotFresh) {
          cacheLiveStatusSnapshot(snapshot);
        }

        if (!isActive || !snapshot) {
          const bufferedLive = readCachedLiveSessionState(resolvedSessionId);
          const hasBufferedLive =
            !!bufferedLive &&
            (bufferedLive.activities.length > 0 ||
              bufferedLive.status !== "idle" ||
              !!bufferedLive.streamingContent);
          if (hasBufferedLive) return;
          if (
            !loadingRef.current &&
            activeSessionRef.current === resolvedSessionId &&
            !nextActiveIds.includes(resolvedSessionId)
          ) {
            setLiveStatus("idle");
            setLiveActivities([]);
            setLiveCurrentStep(null);
            runActivityBufferRef.current = [];
          }
          if (!nextActiveIds.includes(resolvedSessionId)) {
            clearCachedLiveSessionState(resolvedSessionId);
          }
          return;
        }

        if (activeSessionRef.current !== resolvedSessionId) return;
        const snapshotLatest = snapshotLatestTimestamp(snapshot);
        const latestKnownTimestamp =
          latestStatusTimestampBySessionRef.current[resolvedSessionId] || 0;
        if (
          snapshotLatest > 0 &&
          latestKnownTimestamp > 0 &&
          snapshotLatest + 25 < latestKnownTimestamp
        ) {
          return;
        }
        if (snapshotLatest > latestKnownTimestamp) {
          latestStatusTimestampBySessionRef.current[resolvedSessionId] = snapshotLatest;
        }
        const localActivities = mergeActivityLists(
          runActivityBufferRef.current,
          liveActivitiesRef.current
        );
        const resolved = resolveSnapshotLiveState(snapshot, localActivities);
        setLiveStatus(resolved.status);
        setLiveActivities(resolved.activities);
        liveActivitiesRef.current = resolved.activities.map((activity) => ({ ...activity }));
        runActivityBufferRef.current = resolved.activities.map((activity) => ({
          ...activity,
        }));
        setLiveCurrentStep(resolved.currentStep);
      } catch (error) {
        console.error("Failed to hydrate session status:", error);
      }
    },
    [
      cacheLiveStatusSnapshot,
      isSessionStopSuppressed,
      resolveSnapshotLiveState,
      snapshotLatestTimestamp,
    ]
  );

  const refreshPendingMessages = useCallback(async (targetSessionId?: string | null) => {
    const resolvedSessionId =
      typeof targetSessionId === "string" && targetSessionId.trim().length > 0
        ? targetSessionId.trim()
        : null;
    if (!resolvedSessionId) return;
    try {
      const response = await chatApi.getPendingMessages(resolvedSessionId);
      if (!response.success || !response.data) return;
      if (activeSessionRef.current !== resolvedSessionId) return;
      const serverMessages = response.data?.pendingMessages;
      setPendingMessages((current) =>
        mergePendingChatMessages(serverMessages, current, { preserveOptimistic: false })
      );
      if (Array.isArray(serverMessages) && serverMessages.length === 0) {
        clearCachedOptimisticPendingMessages(resolvedSessionId);
      }
    } catch {}
  }, []);

  const resetChatSession = useCallback(
    (options?: { resetAgentSelection?: boolean }) => {
      suppressAutoRestoreRef.current = true;
      activeSessionRef.current = null;
      restoreSessionGenerationRef.current += 1;
      loadingRef.current = false;
      setLoadingSessionId(null);
      setLiveActivities([]);
      setLiveStatus("idle");
      setLiveCurrentStep(null);
      setStreamingContent("");
      setPendingMessages([]);
      setSessionContextUsage(null);
      setSessionTokenUsage(null);
      setTimeToFirstTokenMs(null);
      ttftStartRef.current = null;
      persistSessionId(null);
      clearChat();
      if (options?.resetAgentSelection) {
        setSessionAgentId(null);
        setSelectedAgentId(undefined);
        setUseModelRouter(false);
      }
    },
    [clearChat]
  );

  useEffect(() => {
    activeSessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    setShowEnvironmentOverview(false);
  }, [sessionId]);

  useEffect(() => {
    const cached = readCachedLiveSessionState(sessionId);
    if (cached) {
      setLiveStatus(cached.status);
      setLiveActivities(cached.activities);
      liveActivitiesRef.current = cached.activities.map((activity) => ({ ...activity }));
      setStreamingContent(cached.streamingContent);
      setLiveCurrentStep(cached.currentStep);
      runActivityBufferRef.current = cached.activities.map((activity) => ({ ...activity }));
    } else {
      setLiveStatus("idle");
      setLiveActivities([]);
      liveActivitiesRef.current = [];
      setStreamingContent(null);
      setLiveCurrentStep(null);
      runActivityBufferRef.current = [];
    }
    acceptEventsUntilRef.current = 0;
    if (!sessionId) {
      setPendingMessages([]);
      return;
    }

    const cachedOptimistic = readCachedOptimisticPendingMessages(sessionId);
    if (cachedOptimistic.length > 0) {
      setPendingMessages((current) => mergePendingChatMessages(current, cachedOptimistic));
    }

    void refreshPendingMessages(sessionId);
    void hydrateSessionStatus(sessionId);
    return;
  }, [hydrateSessionStatus, refreshPendingMessages, sessionId]);

  useEffect(() => {
    liveActivitiesRef.current = liveActivities.map((activity) => ({ ...activity }));
  }, [liveActivities]);

  useEffect(() => {
    if (!sessionId || liveActivities.length === 0 || typedMessages.length === 0) return;
    const prunedActivities = pruneCanonicalizedLiveActivities(typedMessages, liveActivities);
    const prunedBuffer = pruneCanonicalizedLiveActivities(
      typedMessages,
      runActivityBufferRef.current
    );
    const activitiesChanged = prunedActivities.length !== liveActivities.length;
    const bufferChanged = prunedBuffer.length !== runActivityBufferRef.current.length;
    if (!activitiesChanged && !bufferChanged) return;

    if (bufferChanged) {
      runActivityBufferRef.current = prunedBuffer.map((activity) => ({ ...activity }));
    }
    if (activitiesChanged) {
      setLiveActivities(prunedActivities);
    }
    if (
      prunedActivities.length === 0 &&
      prunedBuffer.length === 0 &&
      !isLoading &&
      !activeSessionIds.includes(sessionId)
    ) {
      setLiveStatus("idle");
      setLiveCurrentStep(null);
      clearCachedLiveSessionState(sessionId);
    }
  }, [activeSessionIds, isLoading, liveActivities, sessionId, typedMessages]);

  useEffect(() => {
    if (!sessionId) return;
    writeCachedOptimisticPendingMessages(sessionId, pendingMessages);
  }, [pendingMessages, sessionId]);

  useEffect(() => {
    if (!sessionId || typedMessages.length === 0) return;
    writeCachedSessionMessages(sessionId, typedMessages);
  }, [sessionId, typedMessages]);

  useEffect(() => {
    if (!sessionId) return;
    const hasLiveState =
      liveStatus !== "idle" ||
      liveActivities.length > 0 ||
      !!liveCurrentStep ||
      !!streamingContent ||
      activeSessionIds.includes(sessionId);
    if (!hasLiveState) {
      clearCachedLiveSessionState(sessionId);
      return;
    }
    writeCachedLiveSessionState(sessionId, {
      status: liveStatus,
      activities: liveActivities,
      currentStep: liveCurrentStep,
      streamingContent,
    });
  }, [activeSessionIds, liveActivities, liveCurrentStep, liveStatus, sessionId, streamingContent]);

  useEffect(() => {
    refreshSessionMessagesRef.current = async (sid: string) => {
      try {
        const result = await loadPersistedCompletion(() => loadSessionMutation.loadFresh(sid));
        if (result?.messagesList && activeSessionRef.current === sid) {
          loadSession(
            sid,
            result.messagesList as ChatMessage[],
            (result as { workspace_dir?: string | null }).workspace_dir || null
          );
          setSessionContextUsage(
            (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null
          );
          setSessionTokenUsage(
            (result as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
          );
          return true;
        }
      } catch {
        return false;
      }
      return false;
    };
  });

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "snapshot") {
          const snapshotIds = Array.isArray(payload.activeSessionIds)
            ? payload.activeSessionIds.filter(
                (candidate): candidate is string =>
                  typeof candidate === "string" &&
                  candidate.trim().length > 0 &&
                  !isSessionStopSuppressed(candidate)
              )
            : [];
          for (const snapshot of payload.activeSessions || []) {
            cacheLiveStatusSnapshot(snapshot);
          }
          setActiveSessionIds(snapshotIds);
          const activeSession = activeSessionRef.current;
          if (activeSession) {
            void hydrateSessionStatus(activeSession);
          }
          return;
        }
        if (payload.type !== "status") {
          if (payload.type === "assistant_token") {
            const delta = typeof payload.delta === "string" ? payload.delta : "";
            if (delta) {
              const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
              if (isSessionStopSuppressed(sessionId)) return;
              cacheAssistantToken(payload);
              const activeSession = activeSessionRef.current;
              if (activeSession && sessionId === activeSession) {
                setStreamingContent((prev) => (prev === null ? delta : prev + delta));
              }
            }
          }
          return;
        }
        const status = typeof payload.status === "string" ? payload.status : "";
        if (!status) return;
        const statusDetail = typeof payload.detail === "string" ? payload.detail.trim() : "";
        const isSteeringHandoff =
          status === "idle" && statusDetail.toLowerCase() === "steering to follow-up...";
        const payloadSessionId =
          typeof payload.sessionId === "string" && payload.sessionId.trim()
            ? payload.sessionId
            : null;
        const statusIsActive =
          status === "thinking" ||
          status === "generating" ||
          status === "compacting" ||
          status === "tool_executing" ||
          status === "tool_completed";
        if (payloadSessionId && isSessionStopSuppressed(payloadSessionId) && statusIsActive) {
          setActiveSessionIds((previous) => previous.filter((id) => id !== payloadSessionId));
          if (payloadSessionId === activeSessionRef.current) {
            setLiveStatus("idle");
            setLiveCurrentStep(null);
            setLiveActivities([]);
            liveActivitiesRef.current = [];
            runActivityBufferRef.current = [];
          }
          clearCachedLiveSessionState(payloadSessionId);
          runStartSyncedSessionsRef.current.delete(payloadSessionId);
          return;
        }
        cacheLiveStatusEvent(payload);
        const payloadTimestamp =
          typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
            ? payload.timestamp
            : 0;
        if (payloadSessionId && payloadTimestamp > 0) {
          const previousTimestamp =
            latestStatusTimestampBySessionRef.current[payloadSessionId] || 0;
          if (payloadTimestamp > previousTimestamp) {
            latestStatusTimestampBySessionRef.current[payloadSessionId] = payloadTimestamp;
          }
        }

        if (payloadSessionId) {
          if (statusIsActive) {
            setActiveSessionIds((previous) =>
              previous.includes(payloadSessionId) ? previous : [...previous, payloadSessionId]
            );
          }
          if ((status === "idle" && !isSteeringHandoff) || status === "error") {
            setActiveSessionIds((previous) => previous.filter((id) => id !== payloadSessionId));
            runStartSyncedSessionsRef.current.delete(payloadSessionId);
          }
        }

        const activeSession = activeSessionRef.current;
        const isEventForVisibleSession =
          !!activeSession && !!payloadSessionId && payloadSessionId === activeSession;
        if (
          !loadingRef.current &&
          Date.now() > acceptEventsUntilRef.current &&
          !isEventForVisibleSession
        ) {
          return;
        }

        if (activeSession && payload.sessionId && payload.sessionId !== activeSession) return;
        if (activeSession && !payload.sessionId) return;

        if (
          statusIsActive &&
          activeSession &&
          !loadingRef.current &&
          Date.now() > acceptEventsUntilRef.current &&
          !runStartSyncedSessionsRef.current.has(activeSession)
        ) {
          runStartSyncedSessionsRef.current.add(activeSession);
          void refreshSessionMessagesRef.current(activeSession);
        }

        if (status === "thinking") {
          markFirstTokenLatency(payloadSessionId);
          if (!payload.toolName) {
            const activeToolStep = getLatestInFlightStep(runActivityBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            const eventTimestamp =
              typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
                ? payload.timestamp
                : undefined;
            if (isMeaningfulThoughtDetail(detail)) {
              appendLiveActivity("result", detail, "__thought", eventTimestamp);
              setLiveCurrentStep(activeToolStep || detail);
            } else {
              setLiveCurrentStep(activeToolStep || "Thinking...");
            }
          }
          setLiveStatus("thinking");
          return;
        }
        if (status === "generating") {
          markFirstTokenLatency(payloadSessionId);
          if (!payload.toolName) {
            const activeToolStep = getLatestInFlightStep(runActivityBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            const eventTimestamp =
              typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
                ? payload.timestamp
                : undefined;
            if (isMeaningfulThoughtDetail(detail)) {
              appendLiveActivity("result", detail, "__thought", eventTimestamp);
              setLiveCurrentStep(activeToolStep || detail);
            } else {
              setLiveCurrentStep(activeToolStep || "Generating response...");
            }
          }
          setLiveStatus("generating");
          return;
        }
        if (status === "compacting") {
          if (!payload.toolName) {
            const activeToolStep = getLatestInFlightStep(runActivityBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            const compactingDetail = isMeaningfulThoughtDetail(detail)
              ? detail
              : "Compacting earlier context...";
            setLiveCurrentStep(activeToolStep || compactingDetail);
          }
          setLiveStatus("compacting");
          return;
        }
        if (status === "idle") {
          if (isSteeringHandoff) {
            const eventTimestamp =
              typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
                ? payload.timestamp
                : undefined;
            appendLiveActivity("result", statusDetail, "__thought", eventTimestamp);
            setLiveStatus("thinking");
            setLiveCurrentStep(statusDetail);
            return;
          }
          setLiveStatus("idle");
          setLiveCurrentStep(null);
          if (!loadingRef.current) {
            const sessionToRefresh = payloadSessionId || activeSession;
            const finalizeLiveState = () => {
              setStreamingContent(null);
              setLiveActivities([]);
              runActivityBufferRef.current = [];
              clearCachedLiveSessionState(sessionToRefresh);
            };
            if (sessionToRefresh && sessionToRefresh === activeSessionRef.current) {
              void refreshSessionMessagesRef.current(sessionToRefresh).finally(finalizeLiveState);
            } else {
              finalizeLiveState();
            }
          }
          return;
        }
        if (status === "tool_executing" || status === "tool_completed" || status === "error") {
          const phase =
            payload.toolPhase ||
            (status === "tool_executing"
              ? "start"
              : status === "tool_completed"
                ? "result"
                : "error");
          const toolName = payload.toolName || "tool";
          const text = formatToolIntent(toolName, {}, phase, payload.detail);
          const eventTimestamp =
            typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
              ? payload.timestamp
              : undefined;
          appendLiveActivity(
            phase,
            text,
            payload.toolName,
            eventTimestamp,
            payload.toolCallId,
            payload.sandboxProvider
          );
          if (phase === "start") {
            setLiveStatus("thinking");
            setLiveCurrentStep(isGenericStatusLabel(text) ? "Thinking..." : text);
          } else {
            const nextActiveStep = getLatestInFlightStep(runActivityBufferRef.current);
            if (nextActiveStep) {
              setLiveCurrentStep(nextActiveStep);
            } else {
              setLiveCurrentStep(null);
            }
          }
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [
    appendLiveActivity,
    cacheAssistantToken,
    cacheLiveStatusEvent,
    cacheLiveStatusSnapshot,
    hydrateSessionStatus,
    isSessionStopSuppressed,
    markFirstTokenLatency,
  ]);

  useEffect(() => {
    const inputEl = inputRef.current;
    if (!inputEl) return;
    inputEl.style.height = "0px";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 220)}px`;
  }, [input]);

  useEffect(() => {
    const composerEl = composerRef.current;
    if (!composerEl) return;

    const updateComposerHeight = () => {
      const nextHeight = composerEl.offsetHeight;
      setComposerHeight((previous) => (previous === nextHeight ? previous : nextHeight));
    };

    updateComposerHeight();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateComposerHeight();
      });
      observer.observe(composerEl);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateComposerHeight);
    return () => window.removeEventListener("resize", updateComposerHeight);
  }, []);

  const canQueueCurrentMessage = useCallback(() => {
    const sessionCurrentlyActive = !!sessionId && activeSessionIds.includes(sessionId);
    const locallyLoadingCurrentSession =
      loadingRef.current && (!sessionId || !loadingSessionId || loadingSessionId === sessionId);
    const pendingCapture = pendingProcessCaptureRef.current;
    const pendingCaptureForCurrentSession =
      !!pendingCapture &&
      (sessionId
        ? !pendingCapture.sessionId || pendingCapture.sessionId === sessionId
        : !pendingCapture.sessionId);
    return (
      sessionCurrentlyActive ||
      locallyLoadingCurrentSession ||
      (isLoading && (!sessionId || loadingSessionId === sessionId)) ||
      pendingCaptureForCurrentSession ||
      liveStatus !== "idle" ||
      liveActivities.length > 0
    );
  }, [activeSessionIds, isLoading, liveActivities.length, liveStatus, loadingSessionId, sessionId]);

  const addAttachmentFiles = async (files: Iterable<File>) => {
    const list = Array.from(files);
    const images: ChatImageAttachment[] = [];
    const texts: ChatFileAttachment[] = [];
    for (const file of list) {
      if (isSupportedImageType(file.type)) {
        if (file.size <= MAX_CHAT_IMAGE_BYTES) images.push(await fileToChatImage(file));
      } else if (isTextLikeFile(file)) {
        if (file.size <= MAX_TEXT_FILE_BYTES) texts.push(await fileToTextAttachment(file));
      }
    }
    if (images.length) {
      setPendingImages((previous) => [...previous, ...images].slice(0, MAX_CHAT_IMAGES));
    }
    if (texts.length) {
      setPendingFiles((previous) => [...previous, ...texts].slice(0, MAX_TEXT_FILES));
    }
  };

  const hasAttachableFiles = (files: Iterable<File>) =>
    Array.from(files).some((file) => isSupportedImageType(file.type) || isTextLikeFile(file));

  const removePendingImage = (index: number) => {
    setPendingImages((previous) => previous.filter((_, i) => i !== index));
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((previous) => previous.filter((_, i) => i !== index));
  };

  const handleComposerPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length === 0 || !hasAttachableFiles(files)) return;
    event.preventDefault();
    void addAttachmentFiles(files);
  };

  const handleComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 0 && hasAttachableFiles(files)) {
      event.preventDefault();
      void addAttachmentFiles(files);
    }
    setImageDragActive(false);
  };

  const handleSend = async () => {
    suppressAutoRestoreRef.current = false;
    const currentMessageWouldQueue = canQueueCurrentMessage() || pendingMessages.length > 0;
    const requestedQueueMode =
      followUpBehaviorEnabled && currentMessageWouldQueue ? "queue" : undefined;
    const requestSessionId = requestedQueueMode
      ? sessionId || activeSessionRef.current
      : sessionId || activeSessionRef.current || crypto.randomUUID();
    const queueMode = requestedQueueMode && requestSessionId ? "queue" : undefined;
    const hasAttachments = pendingImages.length > 0 || pendingFiles.length > 0;
    if (
      (!input.trim() && !hasAttachments) ||
      (currentMessageWouldQueue && !queueMode) ||
      (isLoading && !queueMode)
    )
      return;
    const message = formatAttachedFiles(input, pendingFiles);
    const images = pendingImages;
    setInput("");
    setPendingImages([]);
    setPendingFiles([]);
    let optimisticPendingMessageId: string | null = null;
    if (queueMode && requestSessionId) {
      const now = Date.now();
      optimisticPendingMessageCounterRef.current += 1;
      optimisticPendingMessageId = `optimistic-${now}-${optimisticPendingMessageCounterRef.current}`;
      setPendingMessages((previous) =>
        normalizePendingChatMessages([
          ...previous,
          {
            id: optimisticPendingMessageId!,
            sessionId: requestSessionId,
            clientPendingId: optimisticPendingMessageId,
            content: message,
            createdAt: now,
            updatedAt: now,
            mode: "queued",
            sequence:
              previous.reduce((max, pending) => Math.max(max, pending.sequence || 0), 0) + 1,
          },
        ])
      );
    } else if (!queueMode) {
      loadingRef.current = true;
      activeSessionRef.current = requestSessionId;
      ttftStartRef.current = performance.now();
      setTimeToFirstTokenMs(null);
      if (requestSessionId) {
        persistSessionId(requestSessionId);
      }
      setLoadingSessionId(requestSessionId);
    }
    try {
      const response = await sendMessage(message, {
        workspaceDir: effectiveWorkspaceDir || undefined,
        queueMode,
        sessionId: requestSessionId || undefined,
        clientPendingId: optimisticPendingMessageId || undefined,
        images: images.length ? images : undefined,
      });
      if (response?.queued) {
        setPendingMessages(normalizePendingChatMessages(response.pendingMessages));
        return;
      }
      if (optimisticPendingMessageId) {
        setPendingMessages((previous) =>
          previous.filter((pending) => pending.id !== optimisticPendingMessageId)
        );
      }
      if (response && typeof response === "object" && "agent" in response) {
        const responseRecord = response as Record<string, unknown>;
        const responseAgent =
          responseRecord.agent && typeof responseRecord.agent === "object"
            ? (responseRecord.agent as Record<string, unknown>)
            : null;
        const resolvedAgentId =
          responseAgent && typeof responseAgent.id === "string" ? responseAgent.id : null;
        syncSessionAgentSelection(resolvedAgentId);
      }
      if (response && typeof response === "object" && "contextUsage" in response) {
        const usage = (response as { contextUsage?: SessionContextUsage }).contextUsage;
        setSessionContextUsage(usage ?? null);
      }
      if (response && typeof response === "object" && "tokenUsage" in response) {
        const usage = (response as { tokenUsage?: SessionTokenUsage }).tokenUsage;
        setSessionTokenUsage(usage ?? null);
      }
    } catch (error) {
      if (optimisticPendingMessageId) {
        setPendingMessages((previous) =>
          previous.filter((pending) => pending.id !== optimisticPendingMessageId)
        );
      }
      throw error;
    }
  };

  const handleSteerPendingMessage = useCallback(
    async (pendingMessageId: string) => {
      if (!sessionId) return;
      setSteeringMessageId(pendingMessageId);
      const preSteerActivities = mergeActivityLists(runActivityBufferRef.current, liveActivities);
      const preSteerProcessActivities = finalizeCompletedActivities(preSteerActivities)
        .filter((activity) => {
          const text = activity.text.trim().toLowerCase();
          return (
            text.length > 0 &&
            text !== "steering to follow-up..." &&
            text !== "starting queued follow-up"
          );
        })
        .map((activity) => ({
          id: activity.id,
          phase: activity.phase,
          text: activity.text,
          timestamp: activity.timestamp,
          toolName: activity.toolName,
          toolCallId: activity.toolCallId,
          sandboxProvider: activity.sandboxProvider,
        }));
      try {
        const response = await chatApi.steerPendingMessage(sessionId, pendingMessageId, {
          processActivities: preSteerProcessActivities,
        });
        if (response.success && response.data) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          if (response.data.pendingMessages.length === 0) {
            clearCachedOptimisticPendingMessages(sessionId);
          }
          let materializedMessages: ChatMessage[] = [];
          try {
            const refreshed = await loadSessionMutation.mutateAsync(sessionId);
            if (refreshed?.messagesList) {
              materializedMessages = refreshed.messagesList as ChatMessage[];
              loadSession(
                sessionId,
                materializedMessages,
                (refreshed as { workspace_dir?: string | null }).workspace_dir || null
              );
              syncSessionAgentSelection(
                (refreshed as { agent_id?: string | null }).agent_id || null
              );
              setSessionContextUsage(
                (refreshed as { contextUsage?: SessionContextUsage | null }).contextUsage || null
              );
              setSessionTokenUsage(
                (refreshed as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
              );
            }
          } catch (error) {
            console.error("Failed to refresh steered chat session:", error);
          }
          if (materializedMessages.length === 0) {
            const steeredMessage = response.data.message as ChatMessage;
            const preSteerMessage =
              (response.data.interruptedMessage as ChatMessage | undefined) ||
              buildPreSteeringActivityMessage(steeredMessage, preSteerActivities);
            materializedMessages = [preSteerMessage, steeredMessage].filter(
              (message): message is ChatMessage => !!message
            );
          }
          runActivityBufferRef.current = pruneCanonicalizedLiveActivities(
            materializedMessages,
            runActivityBufferRef.current
          );
          if (pendingProcessCaptureRef.current) {
            pendingProcessCaptureRef.current = {
              ...pendingProcessCaptureRef.current,
              activities: pruneCanonicalizedLiveActivities(
                materializedMessages,
                pendingProcessCaptureRef.current.activities
              ),
            };
          }
          setLiveActivities((previous) =>
            pruneCanonicalizedLiveActivities(materializedMessages, previous)
          );
          return;
        }
        console.error("Failed to steer pending message:", response.error || response.data?.error);
      } finally {
        setSteeringMessageId(null);
      }
    },
    [loadSession, loadSessionMutation, liveActivities, sessionId, syncSessionAgentSelection]
  );

  const handleReorderPendingMessages = useCallback(
    async (orderedIds: string[]) => {
      if (!sessionId || orderedIds.length === 0) return;
      const previousMessages = pendingMessages;
      const byId = new Map(previousMessages.map((message) => [message.id, message]));
      const orderedMessages = orderedIds
        .map((id) => byId.get(id))
        .filter((message): message is PendingChatMessage => !!message);
      if (orderedMessages.length === previousMessages.length) {
        setPendingMessages(orderedMessages);
      }
      try {
        const response = await chatApi.reorderPendingMessages(sessionId, orderedIds);
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error(
          "Failed to reorder pending messages:",
          response.error || response.data?.error
        );
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to reorder pending messages:", error);
      }
    },
    [pendingMessages, sessionId]
  );

  const handleUpdatePendingMessage = useCallback(
    async (pendingMessageId: string, content: string) => {
      if (!sessionId || pendingMessageId.startsWith("optimistic-")) return;
      const nextContent = content.trim();
      if (!nextContent) return;
      const previousMessages = pendingMessages;
      const now = Date.now();
      setPendingMessages((current) =>
        normalizePendingChatMessages(
          current.map((message) =>
            message.id === pendingMessageId
              ? { ...message, content: nextContent, updatedAt: now }
              : message
          )
        )
      );
      setPendingMessageMutationId(pendingMessageId);
      try {
        const response = await chatApi.updatePendingMessage(
          sessionId,
          pendingMessageId,
          nextContent
        );
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error("Failed to update pending message:", response.error || response.data?.error);
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to update pending message:", error);
      } finally {
        setPendingMessageMutationId(null);
      }
    },
    [pendingMessages, sessionId]
  );

  const handleDeletePendingMessage = useCallback(
    async (pendingMessageId: string) => {
      if (!sessionId || pendingMessageId.startsWith("optimistic-")) return;
      const previousMessages = pendingMessages;
      setPendingMessages((current) => current.filter((message) => message.id !== pendingMessageId));
      setPendingMessageMutationId(pendingMessageId);
      try {
        const response = await chatApi.deletePendingMessage(sessionId, pendingMessageId);
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error("Failed to delete pending message:", response.error || response.data?.error);
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to delete pending message:", error);
      } finally {
        setPendingMessageMutationId(null);
      }
    },
    [pendingMessages, sessionId]
  );

  useEffect(() => {
    if (!streamingContent || isLoading) return;
    const latestMessage = typedMessages[typedMessages.length - 1];
    if (latestMessage?.role === "assistant") {
      setStreamingContent(null);
    }
  }, [isLoading, streamingContent, typedMessages]);

  const handleStopActive = useCallback(async () => {
    const activeAgentId = selectedAgentId || sessionAgentId;
    const activeChatSessionId = sessionId || activeSessionRef.current;
    markSessionStopped(activeChatSessionId);
    stopGenerating();
    if (activeChatSessionId) {
      try {
        await chatApi.stopSession(activeChatSessionId);
      } catch (error) {
        console.error("Failed to stop active chat session:", error);
      }
    }
    if (activeAgentId) {
      try {
        await stopAgent.mutateAsync(activeAgentId);
      } catch (error) {
        console.error("Failed to stop active agent:", error);
      }
    }
    if (sessionId) {
      setActiveSessionIds((previous) => previous.filter((id) => id !== sessionId));
      clearCachedLiveSessionState(sessionId);
    }
    setLiveStatus("idle");
    setLiveCurrentStep(null);
    setLiveActivities([]);
    setLoadingSessionId(null);
    runActivityBufferRef.current = [];
    pendingProcessCaptureRef.current = null;
  }, [markSessionStopped, selectedAgentId, sessionAgentId, stopGenerating, stopAgent, sessionId]);

  const handleToggleDictation = useCallback(async () => {
    if (typeof window === "undefined") return;
    const flashStatus = (message: string) => {
      setDictationStatus(message);
      if (dictationStatusTimerRef.current !== null) {
        window.clearTimeout(dictationStatusTimerRef.current);
      }
      dictationStatusTimerRef.current = window.setTimeout(() => {
        setDictationStatus(null);
        dictationStatusTimerRef.current = null;
      }, 3500);
    };
    const failDictation = (message: string) => {
      setDictationError(message);
      setDictationStatus(null);
      useUIStore.getState().addToast("error", message);
    };
    const appendDictationText = (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      setInput((previous) => {
        const trimmed = previous.trimEnd();
        return trimmed.length > 0 ? `${trimmed} ${normalized}` : normalized;
      });
      setDictationError(null);
      flashStatus("Dictation inserted");
    };

    if (!dictationRuntime.engine) {
      failDictation(dictationRuntime.unsupportedReason || "Dictation is not available here.");
      return;
    }

    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (dictationRuntime.engine === "native") {
      if (!SpeechCtor) {
        failDictation("Native dictation is not available in this browser or desktop runtime.");
        return;
      }
      if (!speechRecognitionRef.current) {
        const recognition = new SpeechCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = dictationLanguage;
        recognition.onresult = (event) => {
          const results = event.results;
          if (!results || typeof results.length !== "number" || results.length === 0) return;
          const startIndex =
            typeof event.resultIndex === "number" && Number.isFinite(event.resultIndex)
              ? event.resultIndex
              : 0;
          const finalChunks: string[] = [];

          for (let index = startIndex; index < results.length; index += 1) {
            const result = results[index];
            const alt = result?.[0];
            const transcript = typeof alt?.transcript === "string" ? alt.transcript.trim() : "";
            if (!transcript) continue;
            if (result?.isFinal) {
              finalChunks.push(transcript);
            }
          }

          if (finalChunks.length === 0) return;
          appendDictationText(finalChunks.join(" "));
        };
        recognition.onerror = (event) => {
          const code = event?.error || "unknown";
          const message =
            code === "not-allowed" || code === "service-not-allowed"
              ? "Microphone permission was denied for native dictation."
              : code === "audio-capture"
                ? "No microphone was available for native dictation."
                : code === "no-speech"
                  ? "No speech was detected."
                  : `Native dictation failed: ${code}`;
          failDictation(message);
          setDictating(false);
        };
        recognition.onend = () => {
          setDictating(false);
          if (!dictationError) setDictationStatus(null);
        };
        speechRecognitionRef.current = recognition;
      }

      const recognition = speechRecognitionRef.current;
      if (!recognition) return;
      if (dictating) {
        recognition.stop();
        setDictating(false);
        setDictationStatus(null);
        return;
      }
      try {
        recognition.lang = dictationLanguage;
        setDictationError(null);
        setDictationStatus("Listening with native dictation...");
        recognition.start();
        setDictating(true);
      } catch (error) {
        failDictation(error instanceof Error ? error.message : "Failed to start native dictation.");
        setDictating(false);
      }
      return;
    }

    if (dictationCapabilities.nativeRecorder) {
      if (dictationTranscribing) return;
      if (dictating && nativeRecorderActiveRef.current) {
        nativeRecorderActiveRef.current = false;
        setDictating(false);
        setDictationTranscribing(true);
        setDictationStatus("Transcribing dictation...");
        try {
          const recording = await stopNativeAudioRecording();
          const local = dictationRuntime.serverProvider === "local";
          const payload = local
            ? await audioBlobToLocalPcm(nativeRecordingBlob(recording))
            : recording;
          const response = await chatApi.dictate({
            ...payload,
            provider: dictationRuntime.serverProvider || undefined,
          });
          if (response.success && response.data?.text) {
            appendDictationText(response.data.text);
          } else {
            failDictation(response.error || "No transcript was returned.");
          }
        } catch (error) {
          failDictation(nativeAudioErrorMessage(error, "Dictation transcription failed."));
        } finally {
          setDictationTranscribing(false);
        }
        return;
      }
      try {
        setDictationError(null);
        setDictationStatus("Requesting microphone access...");
        await startNativeAudioRecording();
        nativeRecorderActiveRef.current = true;
        setDictating(true);
        setDictationStatus("Recording for model transcription...");
      } catch (error) {
        failDictation(nativeAudioErrorMessage(error, "Failed to start recording."));
      }
      return;
    }

    const canRecordAudio =
      !!window.navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    if (!canRecordAudio) {
      failDictation(
        window.navigator?.mediaDevices?.getUserMedia
          ? "This runtime cannot record audio for model transcription."
          : "Microphone capture is not available in this browser or desktop runtime."
      );
      return;
    }

    if (dictationTranscribing) return;

    if (dictating) {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      return;
    }

    try {
      setDictationError(null);
      setDictationStatus("Requesting microphone access...");
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
      dictationStreamRef.current = stream;
      dictationChunksRef.current = [];

      const selectedMimeType = preferredRecordingMimeType();
      const recorder = selectedMimeType
        ? new window.MediaRecorder(stream, { mimeType: selectedMimeType })
        : new window.MediaRecorder(stream);
      const recorderMimeType = recorder.mimeType || selectedMimeType || "audio/webm";
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          dictationChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("Dictation recorder error:", event);
        failDictation("Audio recording failed before transcription could start.");
        setDictating(false);
        setDictationTranscribing(false);
      };

      recorder.onstop = async () => {
        setDictating(false);
        const chunks = [...dictationChunksRef.current];
        dictationChunksRef.current = [];
        mediaRecorderRef.current = null;
        if (dictationStreamRef.current) {
          for (const track of dictationStreamRef.current.getTracks()) {
            track.stop();
          }
          dictationStreamRef.current = null;
        }

        if (chunks.length === 0) return;

        try {
          setDictationTranscribing(true);
          setDictationStatus("Transcribing dictation...");
          const blob = new Blob(chunks, { type: recorderMimeType });
          const local = dictationRuntime.serverProvider === "local";
          const payload = local
            ? await audioBlobToLocalPcm(blob)
            : {
                audioBase64: await audioBlobToBase64(blob),
                mimeType: recorderMimeType,
                fileName: "dictation.webm",
              };
          const response = await chatApi.dictate({
            ...payload,
            provider: dictationRuntime.serverProvider || undefined,
          });
          if (response.success && response.data?.text) {
            appendDictationText(response.data.text);
          } else {
            failDictation(response.error || "No transcript was returned.");
          }
        } catch (error) {
          failDictation(error instanceof Error ? error.message : "Dictation transcription failed.");
        } finally {
          setDictationTranscribing(false);
        }
      };

      recorder.start(250);
      setDictating(true);
      setDictationStatus("Recording for model transcription...");
    } catch (error) {
      failDictation(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : error instanceof Error
            ? error.message
            : "Failed to start dictation recording."
      );
      setDictating(false);
      setDictationTranscribing(false);
      if (dictationStreamRef.current) {
        for (const track of dictationStreamRef.current.getTracks()) {
          track.stop();
        }
        dictationStreamRef.current = null;
      }
    }
  }, [
    dictating,
    dictationError,
    dictationCapabilities.nativeRecorder,
    dictationLanguage,
    dictationRuntime.engine,
    dictationRuntime.serverProvider,
    dictationRuntime.unsupportedReason,
    dictationTranscribing,
  ]);

  const applySessionWorkspace = useCallback(
    async (nextWorkspaceDir: string | null) => {
      const previousWorkspaceDir = workspaceDir;
      setWorkspaceDir(nextWorkspaceDir);
      if (nextWorkspaceDir) {
        persistWorkspaceDir(nextWorkspaceDir);
        setLastWorkspaceDir(nextWorkspaceDir);
      }

      if (!sessionId) {
        return;
      }

      setWorkspaceSaving(true);
      try {
        const response = await chatApi.updateSessionWorkspace(sessionId, nextWorkspaceDir);
        if (!response.success || !response.data || response.data.success === false) {
          const message =
            (response.data && "error" in response.data ? response.data.error : null) ||
            response.error ||
            "Failed to update session workspace";
          throw new Error(message || "Failed to update session workspace");
        }
        const resolvedWorkspaceDir = response.data.workspaceDir || null;
        setWorkspaceDir(resolvedWorkspaceDir);
        if (resolvedWorkspaceDir) {
          persistWorkspaceDir(resolvedWorkspaceDir);
          setLastWorkspaceDir(resolvedWorkspaceDir);
        }
      } catch (error) {
        setWorkspaceDir(previousWorkspaceDir || null);
        console.error("Failed to update session workspace:", error);
      } finally {
        setWorkspaceSaving(false);
      }
    },
    [sessionId, setWorkspaceDir, workspaceDir]
  );

  const handleSelectWorkspace = useCallback(async () => {
    if (!isDesktopHostRuntime()) {
      setShowWorkspacePicker(true);
      return;
    }
    try {
      const selectedPath = await openDesktopDirectoryDialog({
        defaultPath: effectiveWorkspaceDir || undefined,
        title: "Select Session Workspace",
      });
      if (selectedPath) {
        await applySessionWorkspace(selectedPath);
      }
    } catch (error) {
      console.error("Failed to select workspace:", error);
      setShowWorkspacePicker(true);
    }
  }, [applySessionWorkspace, effectiveWorkspaceDir]);

  const handleOpenWorkspaceInCybaraIde = useCallback(
    async (targetWorkspaceDir: string) => {
      const normalized = targetWorkspaceDir.trim();
      if (!normalized) return;
      try {
        persistWorkspaceDir(normalized);
        setLastWorkspaceDir(normalized);
        const params = new URLSearchParams();
        params.set("workspacePath", normalized);
        navigate(`/ide?${params.toString()}`);
      } catch (error) {
        useUIStore
          .getState()
          .addToast(
            "error",
            error instanceof Error ? error.message : "Unable to open workspace in Cybara IDE"
          );
      }
    },
    [navigate]
  );

  const handleOpenDiffFileInIde = useCallback(
    (file: FileChangeItem) => {
      const resolvedPath = resolvePathForIde(file.path, effectiveWorkspaceDir);
      if (!resolvedPath) return;
      const params = new URLSearchParams();
      params.set("path", resolvedPath);
      const line = extractFirstTargetLine(file.diff);
      if (line) {
        params.set("line", String(line));
      }
      params.set("from", "chat-diff");
      navigate(`/ide?${params.toString()}`);
    },
    [effectiveWorkspaceDir, navigate]
  );

  const handleDiffPanelResizeStart = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      diffPanelResizeCleanupRef.current?.();
      diffPanelResizeCleanupRef.current = null;
      diffPanelResizeStateRef.current = {
        startX: event.clientX,
        startWidth: diffPanelWidth,
      };
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const state = diffPanelResizeStateRef.current;
        if (!state) return;
        const delta = state.startX - moveEvent.clientX;
        setDiffPanelWidth(clampDiffPanelWidth(state.startWidth + delta));
      };

      const handleMouseUp = () => {
        diffPanelResizeStateRef.current = null;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        diffPanelResizeCleanupRef.current = null;
      };

      diffPanelResizeCleanupRef.current = () => {
        diffPanelResizeStateRef.current = null;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [diffPanelWidth]
  );

  const openArtifactViewer = useCallback(async (artifact: ArtifactSummaryView) => {
    setArtifactViewerTarget(artifact);
    setArtifactViewerLoading(true);
    setArtifactViewerError(null);
    setArtifactViewerContent("");
    setArtifactViewerRawView(false);

    try {
      const url = appendApiTokenParam(
        `/api/sessions/${encodeURIComponent(artifact.sessionId)}/artifacts/${encodeURIComponent(artifact.fileName)}`
      );
      const response = await fetch(url);
      const payload = (await response.json()) as {
        content?: string;
        artifact?: { path?: string };
        error?: string;
      };

      if (!response.ok) {
        const errorMessage =
          typeof payload?.error === "string"
            ? payload.error
            : `Failed to load artifact (${response.status})`;
        throw new Error(errorMessage);
      }
      if (typeof payload.content !== "string") {
        throw new Error("Artifact response did not include content");
      }

      setArtifactViewerTarget((previous) => {
        if (!previous) return artifact;
        const nextPath =
          payload?.artifact && typeof payload.artifact.path === "string"
            ? payload.artifact.path
            : previous.path;
        return {
          ...previous,
          path: nextPath,
        };
      });
      setArtifactViewerContent(payload.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load artifact";
      setArtifactViewerError(message);
      setArtifactViewerContent("");
    } finally {
      setArtifactViewerLoading(false);
    }
  }, []);

  const closeArtifactViewer = useCallback(() => {
    setArtifactViewerTarget(null);
    setArtifactViewerLoading(false);
    setArtifactViewerError(null);
    setArtifactViewerContent("");
    setArtifactViewerRawView(false);
  }, []);

  const capabilityPicker = useChatCapabilityPicker({
    input,
    setInput,
    inputRef,
    workspaceDir: effectiveWorkspaceDir,
    onSend: handleSend,
  });

  const handleConfirmRevert = useCallback(async () => {
    if (!revertTarget) return;
    try {
      setReverting(true);
      await revertToMessage({
        index: revertTarget.index,
        content: revertTarget.content,
        timestamp: revertTarget.timestamp,
      });
      setInput(revertTarget.content);
      setLiveActivities([]);
      setMessageProcessMap({});
      pendingProcessCaptureRef.current = null;
      setLiveStatus("idle");
      setLiveCurrentStep(null);
      setLoadingSessionId(null);
      setRevertTarget(null);
      inputRef.current?.focus();
    } catch (error) {
      console.error("Failed to revert session:", error);
    } finally {
      setReverting(false);
    }
  }, [revertTarget, revertToMessage]);

  useEffect(() => {
    const sessionParam = initialChatRoute.sessionId;
    const persistedSessionId = readPersistedSessionId();
    const restoreGeneration = restoreSessionGenerationRef.current;
    const isRestorableChatSessionId = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0 && !value.startsWith("agent:");
    const restoreSessionFromId = async (
      targetSessionId: string,
      options?: { replaceRoute?: boolean }
    ) => {
      if (!targetSessionId || targetSessionId === sessionId) return true;
      try {
        const result = await loadSessionMutation.mutateAsync(targetSessionId);
        if (!result?.messagesList) return false;
        if (restoreSessionGenerationRef.current !== restoreGeneration || activeSessionRef.current) {
          return true;
        }
        activeSessionRef.current = targetSessionId;
        loadSession(
          targetSessionId,
          result.messagesList as ChatMessage[],
          (result as { workspace_dir?: string | null }).workspace_dir || null
        );
        syncSessionAgentSelection((result as { agent_id?: string | null }).agent_id || null);
        setSessionContextUsage(
          (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null
        );
        setSessionTokenUsage(
          (result as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
        );
        void hydrateSessionStatus(targetSessionId);
        if (options?.replaceRoute) {
          window.history.replaceState({}, "", "/chat");
        }
        return true;
      } catch (error) {
        console.error("Failed to restore chat session:", error);
        return false;
      }
    };
    const resolveFreshestActiveSessionId = async () => {
      try {
        const response = await chatApi.getSessionStatus();
        if (!response.success || !response.data) return null;
        const payload = response.data as SessionStatusResponse;
        const activeSnapshots = Array.isArray(payload.activeSessions) ? payload.activeSessions : [];
        const activeIds = Array.isArray(payload.activeSessionIds) ? payload.activeSessionIds : [];
        setActiveSessionIds(activeIds.filter(isRestorableChatSessionId));
        if (restoreSessionGenerationRef.current !== restoreGeneration || activeSessionRef.current) {
          return null;
        }
        return (
          activeSnapshots
            .filter((snapshot) => isRestorableChatSessionId(snapshot.sessionId))
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]?.sessionId ||
          activeIds.find(isRestorableChatSessionId) ||
          null
        );
      } catch (error) {
        console.error("Failed to inspect active chat sessions:", error);
        return null;
      }
    };

    void (async () => {
      if (initialChatRoute.startFresh) {
        suppressAutoRestoreRef.current = true;
        persistSessionId(null);
        window.history.replaceState({}, "", "/chat");
        return;
      }
      if (sessionParam) {
        await restoreSessionFromId(sessionParam, { replaceRoute: true });
        return;
      }
      if (suppressAutoRestoreRef.current) return;
      if (sessionId) return;
      const activeSessionLookup = resolveFreshestActiveSessionId();
      if (persistedSessionId) {
        const restored = await restoreSessionFromId(persistedSessionId);
        if (restored) return;
        if (readPersistedSessionId() === persistedSessionId) {
          persistSessionId(null);
        }
      }
      const freshestActiveSessionId = await activeSessionLookup;
      if (!freshestActiveSessionId) return;
      persistSessionId(freshestActiveSessionId);
      await restoreSessionFromId(freshestActiveSessionId);
    })();
  }, []); // Only run on mount

  const revertRemovedCount = revertTarget
    ? Math.max(0, typedMessages.length - revertTarget.index)
    : 0;
  const revertFollowingCount = Math.max(0, revertRemovedCount - 1);
  const currentSessionIsActive = !!sessionId && activeSessionIds.includes(sessionId);
  const currentSessionIsLoading = isLoading && loadingSessionId === sessionId;
  const pendingCapture = pendingProcessCaptureRef.current;
  const pendingCaptureForCurrentSession =
    !!pendingCapture &&
    (sessionId
      ? !pendingCapture.sessionId || pendingCapture.sessionId === sessionId
      : !pendingCapture.sessionId);
  const showWorkingTimeline =
    currentSessionIsLoading ||
    currentSessionIsActive ||
    pendingCaptureForCurrentSession ||
    liveActivities.length > 0;
  const composerHasDraft =
    input.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0;
  const sendQueuesFollowUp =
    followUpBehaviorEnabled && (showWorkingTimeline || pendingMessages.length > 0);
  const showStopComposerButton = showWorkingTimeline && (!composerHasDraft || !sendQueuesFollowUp);
  const timelineActivities =
    liveActivities.length > 0
      ? liveActivities
      : pendingCaptureForCurrentSession
        ? pendingCapture?.activities || []
        : [];
  const timelineStatus =
    currentSessionIsActive && liveStatus === "idle" ? ("thinking" as const) : liveStatus;

  return (
    <div className="h-screen flex flex-col bg-[#050508]">
      <LocalFolderPickerModal
        isOpen={showWorkspacePicker}
        onClose={() => setShowWorkspacePicker(false)}
        onSelect={applySessionWorkspace}
        defaultPath={effectiveWorkspaceDir}
        title="Select Session Workspace"
        description="Choose the local folder this chat should use for file tools, git context, and workspace-aware prompts."
      />
      <div className="relative flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/5 bg-[#0a0a0f]/90 backdrop-blur-xl flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => setShowSessionsPanel(!showSessionsPanel)}
            className={cn(
              "p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
              showSessionsPanel ? "accent-text" : "text-gray-500"
            )}
            title="Sessions"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          {sessionId ? (
            <ChatHeaderTitleMenu
              sessionId={sessionId}
              messages={typedMessages}
              agentId={chatAgentId ?? selectedAgentId ?? sessionAgentId ?? undefined}
              workspaceDir={effectiveWorkspaceDir}
              useModelRouter={useModelRouter}
              contextUsage={sessionContextUsage}
              tokenUsage={sessionTokenUsage}
              appVersion={info?.version}
              onDeleted={() => resetChatSession({ resetAgentSelection: false })}
            />
          ) : (
            <h1 className="text-sm sm:text-base font-semibold text-white">New chat</h1>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <WorkspaceOpenMenu
            workspaceDir={effectiveWorkspaceDir}
            workspaceSaving={workspaceSaving}
            onSelectWorkspace={() => void handleSelectWorkspace()}
            onOpenCybaraIde={handleOpenWorkspaceInCybaraIde}
          />
          <button
            aria-label="File diffs"
            onClick={() => {
              toggleWorkspaceTab("review");
            }}
            className={cn(
              "relative p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
              showWorkspacePanel && activeWorkspaceKind === "review"
                ? "text-indigo-300 bg-white/[0.04]"
                : "text-gray-500"
            )}
            title="File diffs"
          >
            <FileText className="w-4 h-4" />
          </button>
          <button
            aria-label="Environment overview"
            onClick={() => {
              setShowEnvironmentOverview((value) => !value);
            }}
            className={cn(
              "relative p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
              showEnvironmentOverview ? "text-gray-200 bg-white/[0.04]" : "text-gray-500"
            )}
            title="Environment overview"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              toggleWorkspaceTab("subagents");
            }}
            className={cn(
              "relative p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
              showWorkspacePanel && activeWorkspaceKind === "subagents"
                ? "text-gray-200 bg-white/[0.04]"
                : "text-gray-500"
            )}
            title="Subagents"
          >
            <SubagentIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowWorkspacePanel((value) => !value)}
            className={cn(
              "p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
              showWorkspacePanel ? "text-gray-200 bg-white/[0.04]" : "text-gray-500"
            )}
            title="Workspace panel"
            aria-label="Workspace panel"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
          <ChatEnvironmentOverview
            key={sessionId || "new-chat-environment"}
            contextUsage={sessionContextUsage}
            currentPlan={environmentPlan}
            fileChanges={sessionFileChanges}
            gitBranch={environmentGit.currentBranch}
            gitBranchChanging={environmentGit.changingBranch}
            gitBranchError={environmentGit.error}
            gitBranchLoading={environmentGit.loading}
            gitBranches={environmentGit.branches}
            isOpen={showEnvironmentOverview}
            onClose={() => setShowEnvironmentOverview(false)}
            onCreateGitBranch={environmentGit.createAndCheckout}
            onRefreshGitBranches={environmentGit.refresh}
            onSwitchGitBranch={environmentGit.checkout}
            onOpenWorkspaceTab={openWorkspaceTab}
            previewTabs={Array.from(
              new Set(
                workspaceTabs
                  .map((instance) => instance.kind)
                  .filter((kind) => kind === "browser" || kind === "terminal" || kind === "files")
              )
            )}
            agentUsingBrowser={agentUsingBrowser}
            timeToFirstTokenMs={timeToFirstTokenMs}
            onDismissPlan={dismissEnvironmentPlan}
            sessionId={sessionId}
            subagents={environmentSubagents}
            tokenUsage={sessionTokenUsage}
            toolNames={environmentToolNames}
            workspaceDir={effectiveWorkspaceDir}
          />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {!artifactViewerTarget && showSessionsPanel && (
          <SessionsPanel
            isOpen={showSessionsPanel}
            onClose={() => setShowSessionsPanel(false)}
            currentSessionId={sessionId}
            activeSessionIds={activeSessionIds}
            currentSessionLoading={isLoading}
            onLoadSession={(
              id,
              msgs,
              loadedWorkspaceDir,
              loadedAgentId,
              loadedContextUsage,
              loadedTokenUsage
            ) => {
              suppressAutoRestoreRef.current = false;
              activeSessionRef.current = id;
              setUseModelRouter(false);
              loadSession(id, msgs, loadedWorkspaceDir);
              syncSessionAgentSelection(loadedAgentId);
              setSessionContextUsage(loadedContextUsage ?? null);
              setSessionTokenUsage(loadedTokenUsage ?? null);
            }}
            onNewSession={(nextWorkspaceDir) => {
              resetChatSession({ resetAgentSelection: true });
              if (nextWorkspaceDir) {
                setWorkspaceDir(nextWorkspaceDir);
                persistWorkspaceDir(nextWorkspaceDir);
                setLastWorkspaceDir(nextWorkspaceDir);
              }
            }}
          />
        )}

        <div className="relative flex-1 flex flex-col min-w-0">
          <PendingApprovalsBanner />
          {artifactViewerTarget ? (
            <ArtifactViewerPanel
              artifact={artifactViewerTarget}
              loading={artifactViewerLoading}
              error={artifactViewerError}
              content={artifactViewerContent}
              rawView={artifactViewerRawView}
              onBack={closeArtifactViewer}
              onToggleView={setArtifactViewerRawView}
            />
          ) : (
            <>
              <div
                ref={messagesContainerRef}
                onScroll={refreshScrollToBottomVisibility}
                className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4"
              >
                {typedMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-[calc(100%-1rem)]">
                    <div className="text-center text-gray-500">
                      <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-medium">Start a conversation</p>
                      <p className="text-[12px] mt-1 text-gray-600">
                        Ask questions, get help with code, or chat with your agents
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleSelectWorkspace()}
                        disabled={workspaceSaving}
                        className="mt-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 hover:bg-blue-500/15 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                        title={
                          effectiveWorkspaceDir
                            ? "Click to change workspace"
                            : "Select workspace folder for this session"
                        }
                      >
                        {workspaceSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-300" />
                        ) : (
                          <Folder className="h-3.5 w-3.5 text-blue-300" />
                        )}
                        <span className="text-[12px] text-blue-200 font-mono">
                          {effectiveWorkspaceDir
                            ? `Workspace: ${effectiveWorkspaceDir}`
                            : "Select workspace"}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  visibleMessageEntries.map(({ message, originalIndex, turnStartedAtMs }) => {
                    const persistedProcessActivities = getMessageProcessActivities(
                      messageProcessMap,
                      sessionId,
                      message,
                      originalIndex
                    );
                    const embeddedProcessActivities = normalizeMessageProcessActivities(
                      message.process_activities,
                      parseTimestampMs(message.timestamp) ?? turnStartedAtMs
                    );
                    const restoredProcessActivities = mergeActivityLists(
                      persistedProcessActivities,
                      embeddedProcessActivities
                    );
                    const fallbackToolActivities =
                      restoredProcessActivities.length === 0
                        ? buildActivitiesFromToolCalls(message.tool_calls, formatToolIntent, {
                            baseTimestampMs:
                              parseTimestampMs(message.timestamp) ?? turnStartedAtMs ?? 0,
                          })
                        : [];
                    const mergedActivities = suppressRecoveredWebFailureActivities(
                      mergeActivityLists(restoredProcessActivities, fallbackToolActivities),
                      message.tool_calls
                    );
                    const processActivities =
                      mergedActivities.length > 0
                        ? finalizeCompletedActivities(mergedActivities)
                        : undefined;
                    const hasAssistantToolCalls =
                      message.role !== "user" &&
                      Array.isArray(message.tool_calls) &&
                      message.tool_calls.length > 0;
                    return (
                      <div
                        key={`${message.timestamp || "msg"}-${originalIndex}`}
                        className={`deferred-chat-message flex gap-3 ${
                          message.role === "user" ? "flex-row-reverse" : ""
                        }`}
                      >
                        {message.role === "user" && (
                          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-[rgba(var(--accent-primary),0.2)]">
                            <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 accent-text" />
                          </div>
                        )}
                        <div
                          className={
                            message.role === "user"
                              ? "max-w-[85%] sm:max-w-[75%] lg:max-w-[65%] text-right"
                              : "w-full min-w-0"
                          }
                        >
                          <div
                            className={
                              message.role === "user"
                                ? "rounded-xl sm:rounded-2xl px-3 py-2 sm:px-4 sm:py-3 border border-[rgba(var(--accent-primary),0.2)]"
                                : "py-1"
                            }
                          >
                            {message.role !== "user" && (
                              <AssistantMetaInline
                                message={message}
                                processActivities={processActivities}
                                sessionId={sessionId}
                                turnStartedAtMs={turnStartedAtMs}
                                onOpenArtifact={openArtifactViewer}
                                section="work"
                                workspaceDir={effectiveWorkspaceDir}
                              />
                            )}
                            {hasAssistantToolCalls && (
                              <div className="my-2 border-t border-white/12" />
                            )}
                            {message.images && message.images.length > 0 && (
                              <div
                                className={cn(
                                  "flex flex-wrap gap-2",
                                  message.content ? "mb-2" : "",
                                  message.role === "user" ? "justify-end" : ""
                                )}
                              >
                                {message.images.map((image, imageIndex) => {
                                  const src = chatImageSrc(image);
                                  if (!src) return null;
                                  return (
                                    <button
                                      type="button"
                                      key={`msg-image-${originalIndex}-${imageIndex}`}
                                      onClick={() => openChatImage(src, image.name || "Attachment")}
                                      data-chat-lightbox-src={src}
                                      data-chat-lightbox-alt={image.name || "Attachment"}
                                      className="block max-w-[220px] cursor-zoom-in overflow-hidden rounded-lg border border-white/12"
                                      aria-label={`Open ${image.name || "attachment"} preview`}
                                    >
                                      <img
                                        src={src}
                                        alt="Attachment"
                                        loading="lazy"
                                        className="h-auto max-h-64 w-full object-contain"
                                      />
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <MessageContent content={message.content} onOpenImage={openChatImage} />
                            {message.role !== "user" &&
                              (() => {
                                const outputImages = (message.tool_calls || [])
                                  .map((toolCall) => imageToolResultSrc(toolCall.result))
                                  .filter((src): src is string => !!src);
                                if (outputImages.length === 0) return null;
                                return (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {outputImages.map((src, imageIndex) => (
                                      <button
                                        type="button"
                                        key={`tool-image-${originalIndex}-${imageIndex}`}
                                        onClick={() => openChatImage(src, "Tool output")}
                                        data-chat-lightbox-src={src}
                                        data-chat-lightbox-alt="Tool output"
                                        className="block max-w-[320px] cursor-zoom-in overflow-hidden rounded-lg border border-white/12"
                                        aria-label="Open tool output preview"
                                      >
                                        <img
                                          src={src}
                                          alt="Tool output"
                                          loading="lazy"
                                          className="h-auto max-h-80 w-full object-contain"
                                        />
                                      </button>
                                    ))}
                                  </div>
                                );
                              })()}
                            {message.role !== "user" && (
                              <AssistantMetaInline
                                message={message}
                                processActivities={processActivities}
                                sessionId={sessionId}
                                turnStartedAtMs={turnStartedAtMs}
                                onOpenArtifact={openArtifactViewer}
                                section="summary"
                                workspaceDir={effectiveWorkspaceDir}
                              />
                            )}
                          </div>

                          <div
                            className={cn(
                              "mt-1.5 flex items-center gap-1.5",
                              message.role === "user" ? "justify-end" : "justify-start"
                            )}
                          >
                            {message.timestamp && (
                              <span className="text-[10px] text-gray-600">
                                {formatRelativeTime(message.timestamp)}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleCopyMessage(originalIndex, message.content)}
                              className="p-1 rounded-md text-gray-600 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                              title="Copy message"
                              aria-label="Copy message"
                            >
                              {copiedMessageIndex === originalIndex ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                            {message.role === "assistant" && message.content.trim() && (
                              <button
                                type="button"
                                onClick={() => void handleReadAloud(originalIndex, message.content)}
                                className="p-1 rounded-md text-gray-600 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                                title={
                                  speakingMessageIndex === originalIndex
                                    ? "Stop reading aloud"
                                    : "Read aloud"
                                }
                                aria-label={
                                  speakingMessageIndex === originalIndex
                                    ? "Stop reading aloud"
                                    : "Read aloud"
                                }
                              >
                                {speakingMessageIndex === originalIndex ? (
                                  <VolumeX className="h-3 w-3" />
                                ) : (
                                  <Volume2 className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            {sessionId && (
                              <button
                                type="button"
                                onClick={() => void handleForkSession(originalIndex)}
                                disabled={forkingMessageIndex !== null}
                                className="p-1 rounded-md text-gray-600 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
                                title="Fork chat from this message"
                                aria-label="Fork chat from this message"
                              >
                                {forkingMessageIndex === originalIndex ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <GitFork className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            {message.role === "assistant" && sessionId && (
                              <button
                                type="button"
                                onClick={() => void handleSaveGolden(originalIndex)}
                                disabled={savingGoldenMessageIndex !== null}
                                className="p-1 rounded-md text-gray-600 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
                                title="Save turn as golden test"
                                aria-label="Save turn as golden test"
                              >
                                {savingGoldenMessageIndex === originalIndex ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <FlaskConical className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            {message.role === "user" && sessionId && (
                              <button
                                type="button"
                                onClick={() =>
                                  setRevertTarget({
                                    index: originalIndex,
                                    content: message.content,
                                    timestamp: message.timestamp,
                                  })
                                }
                                className="p-1 rounded-md text-gray-600 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                                title="Revert session to this message"
                                aria-label="Revert session to this message"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {showWorkingTimeline && (
                  <div className="w-full min-w-0 py-1">
                    <LiveActivityTimeline
                      status={timelineStatus}
                      activities={timelineActivities}
                      currentStep={liveCurrentStep}
                    />
                  </div>
                )}
              </div>

              {showScrollToBottomButton && (
                <button
                  type="button"
                  onClick={() => scrollToBottom()}
                  className="absolute left-1/2 z-20 -translate-x-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#11131c]/95 text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors hover:bg-[#1a1e2b] cursor-pointer"
                  style={{ bottom: `${Math.max(70, composerHeight + 10)}px` }}
                  title="Scroll to latest"
                  aria-label="Scroll to latest message"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              )}

              <div
                ref={composerRef}
                className="chat-composer-responsive flex-shrink-0 px-3 sm:px-4 py-3 border-t border-white/5 bg-[#0a0a0f]/80 backdrop-blur-xl"
              >
                {showComposerPlan && currentSessionPlan && currentSessionPlanKey && (
                  <PlanSummaryCard
                    plan={currentSessionPlan}
                    compact
                    dismissible
                    expandable
                    onDismiss={() => setHiddenComposerPlanKey(currentSessionPlanKey)}
                  />
                )}
                {pendingMessages.length > 0 && (
                  <PendingChatQueue
                    messages={pendingMessages}
                    onSteer={handleSteerPendingMessage}
                    onReorder={handleReorderPendingMessages}
                    onUpdate={handleUpdatePendingMessage}
                    onDelete={handleDeletePendingMessage}
                    steeringMessageId={steeringMessageId}
                    mutatingMessageId={pendingMessageMutationId}
                  />
                )}
                {(dictationError || dictationStatus) && (
                  <div
                    className={cn(
                      "mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]",
                      dictationError
                        ? "border-red-500/25 bg-red-500/10 text-red-200"
                        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                    )}
                    role={dictationError ? "alert" : "status"}
                  >
                    {dictationError ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    ) : dictating ? (
                      <Mic className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {dictationError || dictationStatus}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    "relative rounded-[22px] border bg-white/[0.035] px-3 py-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] transition-colors",
                    imageDragActive ? "border-[rgba(var(--accent-primary),0.6)]" : "border-white/10"
                  )}
                  onDragOver={(e) => {
                    if (Array.from(e.dataTransfer?.items || []).some((i) => i.kind === "file")) {
                      e.preventDefault();
                      setImageDragActive(true);
                    }
                  }}
                  onDragLeave={() => setImageDragActive(false)}
                  onDrop={handleComposerDrop}
                >
                  {(pendingImages.length > 0 || pendingFiles.length > 0) && (
                    <div className="mb-2">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-gray-400">
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span>{mediaSummaryLabel(pendingImages, pendingFiles)}</span>
                        {pendingImages.length >= MAX_CHAT_IMAGES && (
                          <span className="text-amber-300/80">· max {MAX_CHAT_IMAGES} images</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {pendingImages.map((image, index) => (
                          <div
                            key={`pending-image-${index}`}
                            className="group relative h-16 w-16 overflow-hidden rounded-lg border border-white/12"
                            title={`${image.name || "image"}${
                              imageAttachmentBytes(image)
                                ? ` · ${formatBytes(imageAttachmentBytes(image))}`
                                : ""
                            }`}
                          >
                            <img
                              src={chatImageSrc(image)}
                              alt={image.name || "Attachment preview"}
                              className="h-full w-full object-cover"
                            />
                            {imageAttachmentBytes(image) > 0 && (
                              <span className="absolute bottom-0 left-0 right-0 bg-black/55 px-1 py-px text-[9px] leading-tight text-white/90">
                                {formatBytes(imageAttachmentBytes(image))}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => removePendingImage(index)}
                              className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                              aria-label="Remove image"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                        {pendingFiles.map((file, index) => (
                          <div
                            key={`pending-file-${index}`}
                            className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-2 py-1 text-xs text-gray-200"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="max-w-[160px] truncate">{file.name}</span>
                              {formatBytes(file.size) && (
                                <span className="text-[10px] text-gray-500">
                                  {formatBytes(file.size)}
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => removePendingFile(index)}
                              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-white/10 hover:text-white"
                              aria-label="Remove file"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,text/*,.md,.markdown,.json,.jsonc,.csv,.tsv,.xml,.yaml,.yml,.toml,.ini,.log,.html,.css,.scss,.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cc,.cs,.php,.sh,.bash,.zsh,.sql,.env,.vue,.svelte"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void addAttachmentFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <textarea
                    ref={inputRef}
                    data-chat-composer-input="true"
                    value={input}
                    onChange={capabilityPicker.onChange}
                    onKeyDown={capabilityPicker.onKeyDown}
                    onClick={(e) => capabilityPicker.onCursorChange(e.currentTarget.selectionStart)}
                    onKeyUp={(e) => capabilityPicker.onCursorChange(e.currentTarget.selectionStart)}
                    onPaste={handleComposerPaste}
                    placeholder={t("chat.composer.placeholder")}
                    rows={1}
                    className="w-full min-h-[38px] max-h-[220px] overflow-y-auto resize-none bg-transparent px-0 py-1 text-[13px] leading-5 text-white placeholder-gray-500 !outline-none"
                  />
                  {capabilityPicker.menuOpen && (
                    <ChatCapabilityMenu
                      options={capabilityPicker.options}
                      selectedIndex={capabilityPicker.selectedIndex}
                      loading={capabilityPicker.loading}
                      onSelect={capabilityPicker.select}
                    />
                  )}
                  <div className="mt-0.5 flex min-h-8 items-center gap-1.5">
                    <ChatApprovalControls
                      mode={toolApprovalMode}
                      onChange={(mode) => void updateToolApprovalMode(mode)}
                      updating={savingToolApprovalMode}
                    />
                    <div className="min-w-0 flex-1" />
                    <ChatAgentControls
                      agents={agents}
                      selectedAgentId={selectedAgentId}
                      modelRouterEnabled={modelRouterEnabled}
                      useModelRouter={useModelRouter}
                      contextUsage={sessionContextUsage}
                      providerPlan={activeProviderPlan}
                      onSelectAgent={(agentId) => void handleSelectAgent(agentId)}
                      updating={updateSessionAgent.isPending}
                    />
                    <ChatReasoningControl
                      effort={activeAgentForPlan?.reasoning_effort}
                      provider={
                        activeAgentForPlan?.provider_type ??
                        activeAgentForPlan?.provider ??
                        activeAgentForPlan?.provider_id
                      }
                      model={activeAgentForPlan?.model}
                      disabled={useModelRouter || !activeAgentForPlan}
                      updating={updateAgentReasoning.isPending}
                      onChange={(effort) => {
                        if (!activeAgentForPlan) return;
                        updateAgentReasoning.mutate(
                          { id: activeAgentForPlan.id, effort },
                          {
                            onError: (error) => {
                              useUIStore
                                .getState()
                                .addToast("error", error.message || "Failed to update reasoning");
                            },
                          }
                        );
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="composer-icon-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-gray-400 cursor-pointer hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      title="Attach image or file"
                      aria-label="Attach image or file"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleDictation()}
                      disabled={showWorkingTimeline || dictationTranscribing}
                      className={cn(
                        "composer-icon-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-gray-400 cursor-pointer hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
                        dictating
                          ? "bg-red-500/20 text-red-300"
                          : !dictationRuntime.engine
                            ? "text-amber-200 hover:bg-amber-500/15"
                            : ""
                      )}
                      title={
                        dictationTranscribing
                          ? "Transcribing..."
                          : dictating
                            ? "Stop dictation"
                            : dictationRuntime.engine
                              ? `Start ${dictationRuntime.label.toLowerCase()}`
                              : dictationRuntime.unsupportedReason || "Dictation unavailable"
                      }
                      aria-label={
                        dictationTranscribing
                          ? "Transcribing dictation"
                          : dictating
                            ? "Stop dictation"
                            : dictationRuntime.engine
                              ? `Start ${dictationRuntime.label.toLowerCase()}`
                              : "Show dictation support issue"
                      }
                    >
                      {dictationTranscribing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : dictating ? (
                        <MicOff className="w-4 h-4" />
                      ) : (
                        <Mic className="w-4 h-4" />
                      )}
                    </button>
                    <ChatComposerActionButton
                      disabled={
                        !composerHasDraft ||
                        (showWorkingTimeline && !followUpBehaviorEnabled) ||
                        (isLoading && !sendQueuesFollowUp)
                      }
                      isStopping={stopAgent.isPending}
                      onSend={handleSend}
                      onStop={() => void handleStopActive()}
                      queueing={sendQueuesFollowUp}
                      showStop={showStopComposerButton}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {!artifactViewerTarget && (
          <ChatWorkspacePanel
            activeTab={activeWorkspaceTab}
            isOpen={showWorkspacePanel}
            tabs={workspaceTabs}
            width={diffPanelWidth}
            onClose={() => setShowWorkspacePanel(false)}
            onCloseTab={closeWorkspaceTab}
            onOpenTab={openWorkspaceTab}
            onResizeStart={handleDiffPanelResizeStart}
            onSelectTab={setActiveWorkspaceTab}
          >
            {workspaceTabs.map((instance) => {
              const active = activeWorkspaceTab === instance.id;
              const hiddenClass = cn("h-full", !active && "hidden");
              if (instance.kind === "review") {
                return (
                  <div key={instance.id} className={hiddenClass}>
                    <SessionDiffPanel
                      embedded
                      isOpen={active}
                      summary={sessionFileChanges}
                      selectedPath={selectedDiffPath}
                      onSelectPath={setSelectedDiffPath}
                      onClose={() => closeWorkspaceTab(instance.id)}
                      width={diffPanelWidth}
                      onResizeStart={handleDiffPanelResizeStart}
                      onOpenInIDE={handleOpenDiffFileInIde}
                      workspaceDir={effectiveWorkspaceDir}
                      loading={sessionFileChangesLoading}
                      error={sessionFileChangesError}
                      onRetry={refreshSessionFileChanges}
                    />
                  </div>
                );
              }
              if (instance.kind === "terminal") {
                return (
                  <div key={instance.id} className={hiddenClass}>
                    <EmbeddedTerminalPanel
                      workspacePath={effectiveWorkspaceDir || "~"}
                      visible={showWorkspacePanel && active}
                      createRequestToken={0}
                      autoCreateOnVisible
                      singleSession
                    />
                  </div>
                );
              }
              if (instance.kind === "browser") {
                return (
                  <div key={instance.id} className={hiddenClass}>
                    <ChatWorkspaceBrowser
                      key={`${instance.id}:${sessionId || "new-chat"}`}
                      visible={showWorkspacePanel && active}
                      sessionId={sessionId}
                      pageKey={instance.pageKey}
                      onTitleChange={(title) => updateWorkspaceTabTitle(instance.id, title)}
                    />
                  </div>
                );
              }
              if (instance.kind === "files") {
                return (
                  <div key={instance.id} className={hiddenClass}>
                    <ChatWorkspaceFiles workspaceDir={effectiveWorkspaceDir} />
                  </div>
                );
              }
              if (instance.kind === "computer") {
                return (
                  <div key={instance.id} className={hiddenClass}>
                    <ChatWorkspaceComputer
                      sessionId={sessionId}
                      visible={showWorkspacePanel && active}
                    />
                  </div>
                );
              }
              return (
                <div key={instance.id} className={hiddenClass}>
                  <SubagentPanel
                    embedded
                    agentId={selectedAgentId || sessionAgentId || undefined}
                    isOpen={active}
                    onClose={() => closeWorkspaceTab(instance.id)}
                    sessionId={sessionId}
                    workspaceDir={effectiveWorkspaceDir}
                    onViewSession={async (sessionKey) => {
                      try {
                        const result = await loadSessionMutation.mutateAsync(sessionKey);
                        if (result?.messagesList) {
                          activeSessionRef.current = sessionKey;
                          setUseModelRouter(false);
                          loadSession(
                            sessionKey,
                            result.messagesList as ChatMessage[],
                            (result as { workspace_dir?: string | null }).workspace_dir || null
                          );
                          syncSessionAgentSelection(
                            (result as { agent_id?: string | null }).agent_id || null
                          );
                          setSessionContextUsage(
                            (result as { contextUsage?: SessionContextUsage | null })
                              .contextUsage || null
                          );
                          setSessionTokenUsage(
                            (result as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
                          );
                          setShowWorkspacePanel(false);
                        }
                      } catch (error) {
                        console.error("Failed to load subagent session:", error);
                      }
                    }}
                  />
                </div>
              );
            })}
          </ChatWorkspacePanel>
        )}

        {imageLightbox ? (
          <ChatImageLightbox
            images={imageLightbox.images}
            initialIndex={imageLightbox.index}
            onClose={() => setImageLightbox(null)}
          />
        ) : null}

        <Modal
          isOpen={!!revertTarget}
          onClose={() => {
            if (!reverting) setRevertTarget(null);
          }}
          title="Confirm Revert"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              Are you sure you want to revert here? This will keep this message, remove{" "}
              {revertFollowingCount} later message{revertFollowingCount === 1 ? "" : "s"} from this
              session, then place this text back in the input box for resend.
            </p>
            {revertTarget && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-gray-500 mb-1">
                  Revert Point
                </p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">
                  {revertTarget.content.length > 220
                    ? `${revertTarget.content.slice(0, 220)}...`
                    : revertTarget.content}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setRevertTarget(null)} disabled={reverting}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleConfirmRevert()}
                disabled={reverting}
              >
                {reverting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                Revert Here
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
