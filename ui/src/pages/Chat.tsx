import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useDeferredValue,
  isValidElement,
  type ComponentPropsWithoutRef,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Send,
  Bot,
  User,
  Trash2,
  Wrench,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Zap,
  Plus,
  Square,
  Loader2,
  MessageSquare,
  Pencil,
  X,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  RotateCcw,
  FileText,
  Folder,
  FolderOpen,
  ArrowLeft,
  ArrowDown,
  Mic,
  MicOff,
  ShieldAlert,
  Pin,
  PinOff,
  Search,
} from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useChat,
  useSessions,
  useDeleteSession,
  useLoadSession,
  useRenameSession,
  usePinSession,
} from "@/hooks/useChat";
import {
  useAgents,
  useInfo,
  useSubagents,
  useSpawnSubagent,
  useKillSubagent,
  useStopAgent,
  type Subagent,
} from "@/hooks/useApi";
import { chatApi } from "@/lib/api";
import { PageLayout } from "@/components/layout";
import { GlassCard, GlassButton, Input, Badge, Modal, Button } from "@/components/ui";
import { formatRelativeTime } from "@/lib/utils";
import { appendApiTokenParam, apiFetch } from "@/lib/auth";
import { connectStatusStream } from "@/lib/status-stream";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  mergeActivityLists,
  normalizeActivityTextForPhase,
  type LiveActivityItem,
} from "@/lib/chatActivities";
import { preprocessChatMarkdown } from "@/lib/chatMarkdownPreprocessor";
import {
  getToolCallsInTimelineOrder,
  DIFF_PANEL_MIN_WIDTH,
  PENDING_CAPTURE_TIMEOUT_MS,
  SESSION_ACTIVITY_STALE_MS,
  clampDiffPanelWidth,
  dedupeArtifactSummaries,
  extractFirstTargetLine,
  formatSandboxProviderLabel,
  formatToolIntent,
  formatWorkspaceLabel,
  getLatestInFlightStep,
  getLegacyMessageProcessKey,
  getMessageProcessActivities,
  getMessageProcessKey,
  inferArtifactSummaries,
  isGenericStatusLabel,
  isMeaningfulThoughtDetail,
  isRecord,
  normalizeMessageProcessActivities,
  normalizeSandboxProviderValue,
  normalizeSessionStatus,
  normalizeSnapshotActivities,
  persistDiffPanelWidth,
  persistMessageProcessMap,
  persistSessionId,
  persistWorkspaceDir,
  readPersistedDiffPanelWidth,
  readPersistedMessageProcessMap,
  readPersistedSessionId,
  readPersistedWorkspaceDir,
  resolvePathForIde,
  resolveToolCallSandboxProvider,
  sessionDisplayTitle,
  sessionPreviewText,
  sessionRouteLabel,
  summarizeMessageFileChanges,
  summarizeSessionFileChanges,
  toLiveActivityItems,
  tryParseJsonRecord,
  type ArtifactSummaryView,
  type ChatMessage,
  type FileChangeItem,
  type FileChangeSummary,
  type PendingProcessCapture,
  type RevertTarget,
  type SessionStatusResponse,
  type SpeechRecognitionLike,
  type SpeechRecognitionWindow,
  type ToolCall,
} from "./chat/chatModel";
import { LiveActivityTimeline, ProcessActivityList } from "./chat/ActivityTimeline";
import { DiffCodeBlock, MessageContent } from "./chat/MessageContent";
import { isDesktopHostRuntime, openDesktopDirectoryDialog } from "@/lib/desktopHost";



function FileChangesCard({ summary }: { summary: FileChangeSummary }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full px-3 py-2 flex items-center gap-2 text-[12px] cursor-pointer hover:bg-white/5 transition-colors"
      >
        <Wrench className="w-3 h-3 text-indigo-300" />
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
          {summary.files.map((file) => (
            <div
              key={`${file.path}-${file.type}`}
              className="rounded-md border border-white/10 bg-black/25"
            >
              <div className="flex items-center justify-between gap-3 px-2.5 py-2 text-[12px]">
                <div className="min-w-0">
                  <p className="truncate text-gray-200">{file.path}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-[0.08em]">
                    {file.type}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-green-300">+{file.added}</span>
                  <span className="text-red-300">-{file.removed}</span>
                </div>
              </div>
              {file.diff && <DiffCodeBlock code={file.diff} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


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
}: {
  message: ChatMessage;
  processActivities?: LiveActivityItem[];
  sessionId?: string | null;
  turnStartedAtMs?: number;
  onOpenArtifact?: (artifact: ArtifactSummaryView) => void;
  section?: "work" | "summary";
}) {
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
            Worked for{" "}
            {workedDurationMs !== undefined ? formatWorkedDuration(workedDurationMs) : "0h 00m 00s"}
          </span>
        </div>
      )}

      {isWorkSection && workActivitiesWithSandbox.length > 0 && (
        <ProcessActivityList activities={workActivitiesWithSandbox} />
      )}

      {!isWorkSection && hasFileChangeSummary && fileChangeSummary && (
        <FileChangesCard summary={fileChangeSummary} />
      )}
      {!isWorkSection && hasArtifacts && (
        <ArtifactSummaryCard artifacts={artifactSummary} onOpenArtifact={onOpenArtifact} />
      )}
    </div>
  );
}



function ArtifactViewerPanel({
  artifact,
  loading,
  error,
  content,
  rawView,
  onBack,
  onToggleView,
}: {
  artifact: ArtifactSummaryView | null;
  loading: boolean;
  error: string | null;
  content: string;
  rawView: boolean;
  onBack: () => void;
  onToggleView: (raw: boolean) => void;
}) {
  const resolvedPath =
    artifact?.path ||
    (artifact ? `~/.cybara/artifacts/${artifact.sessionId}/${artifact.fileName}` : "");
  const locationLabel = artifact
    ? `/api/sessions/${encodeURIComponent(artifact.sessionId)}/artifacts/${encodeURIComponent(artifact.fileName)}`
    : "";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 sm:px-4 py-2 border-b border-white/10 bg-[#0a0a0f]/90 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[12px] text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to chat
          </button>
          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[12px] text-gray-300">
            <FileText className="w-3.5 h-3.5 text-indigo-300" />
            <span className="truncate max-w-[280px] sm:max-w-[520px]">
              {artifact?.title || artifact?.fileName || "Artifact"}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleView(false)}
              className={cn(
                "rounded-md border px-2 py-1 text-[12px] transition-colors cursor-pointer",
                !rawView
                  ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-200"
                  : "border-white/15 bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/[0.08]"
              )}
            >
              Markdown
            </button>
            <button
              type="button"
              onClick={() => onToggleView(true)}
              className={cn(
                "rounded-md border px-2 py-1 text-[12px] transition-colors cursor-pointer",
                rawView
                  ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-200"
                  : "border-white/15 bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/[0.08]"
              )}
            >
              Raw
            </button>
          </div>
        </div>
        {artifact && (
          <div className="mt-2 space-y-1 text-[12px] text-gray-500">
            <p className="truncate">Path: {resolvedPath}</p>
            <p className="truncate">Endpoint: {locationLabel}</p>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading artifact...
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        ) : rawView ? (
          <pre className="max-h-full overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[12px] text-gray-200 whitespace-pre-wrap">
            {content}
          </pre>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <MessageContent content={content} />
          </div>
        )}
      </div>
    </div>
  );
}

function SessionDiffPanel({
  isOpen,
  summary,
  selectedPath,
  onSelectPath,
  onClose,
  width,
  onResizeStart,
  onOpenInIDE,
}: {
  isOpen: boolean;
  summary: FileChangeSummary | null;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onClose: () => void;
  width: number;
  onResizeStart: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenInIDE: (file: FileChangeItem) => void;
}) {
  if (!isOpen) return null;

  const selectedFile =
    summary?.files.find((file) => file.path === selectedPath) || summary?.files[0] || null;

  return (
    <div
      className="relative glass-strong border-l border-white/5 flex flex-col"
      style={{ width: `${width}px`, minWidth: `${DIFF_PANEL_MIN_WIDTH}px` }}
    >
      <button
        type="button"
        onMouseDown={onResizeStart}
        className="absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize z-20 group"
        title="Resize file diff panel"
        aria-label="Resize file diff panel"
      >
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10 transition-colors group-hover:bg-indigo-400/70" />
      </button>
      <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-indigo-300" />
          <h3 className="text-sm font-medium text-white">File Diffs</h3>
          {summary && summary.files.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-gray-400">
              {summary.files.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {selectedFile && (
            <button
              type="button"
              onClick={() => onOpenInIDE(selectedFile)}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-indigo-300 transition-colors cursor-pointer"
              title="Open selected file in IDE"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
            title="Close file diff panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!summary || summary.files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center text-gray-500">
          <div>
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No file diffs in this session yet</p>
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 text-[12px] text-gray-400 border-b border-white/5 bg-black/10">
            <span className="text-green-300">+{summary.totalAdded}</span>
            <span className="mx-1 text-gray-500">/</span>
            <span className="text-red-300">-{summary.totalRemoved}</span>
            <span className="ml-2">across {summary.files.length} files</span>
          </div>

          <div className="max-h-56 overflow-y-auto p-2 space-y-1.5 border-b border-white/5">
            {summary.files.map((file) => {
              const isSelected = selectedFile?.path === file.path;
              return (
                <div key={`${file.path}-${file.type}`} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => onSelectPath(file.path)}
                    className={cn(
                      "flex-1 text-left rounded-lg border px-2.5 py-2 transition-colors cursor-pointer",
                      isSelected
                        ? "bg-indigo-500/15 border-indigo-500/30"
                        : "bg-white/[0.02] border-white/10 hover:bg-white/[0.06]"
                    )}
                  >
                    <p className="text-[12px] text-gray-100 truncate">{file.path}</p>
                    <p className="mt-1 text-[10px] text-gray-500 uppercase tracking-[0.08em]">
                      {file.type}
                    </p>
                    <div className="mt-1 text-[10px]">
                      <span className="text-green-300">+{file.added}</span>
                      <span className="ml-2 text-red-300">-{file.removed}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenInIDE(file)}
                    className={cn(
                      "px-2 rounded-lg border transition-colors cursor-pointer",
                      isSelected
                        ? "border-indigo-500/30 text-indigo-300 bg-indigo-500/10"
                        : "border-white/10 text-gray-500 bg-white/[0.02] hover:text-indigo-300 hover:bg-white/[0.06]"
                    )}
                    title="Open in IDE"
                    aria-label={`Open ${file.path} in IDE`}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
            {selectedFile ? (
              <div className="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
                <div className="px-2.5 py-2 border-b border-white/10 flex items-center gap-2">
                  <p className="text-[12px] text-gray-200 truncate flex-1">{selectedFile.path}</p>
                  <button
                    type="button"
                    onClick={() => onOpenInIDE(selectedFile)}
                    className="p-1 rounded-md text-gray-500 hover:text-indigo-300 hover:bg-white/5 transition-colors cursor-pointer"
                    title="Open selected file in IDE"
                    aria-label={`Open ${selectedFile.path} in IDE`}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
                {selectedFile.diff ? (
                  <DiffCodeBlock code={selectedFile.diff} />
                ) : (
                  <div className="p-3 text-[12px] text-gray-500">
                    No line-by-line diff captured for this file change.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[12px] text-gray-500">Select a file to view its diff.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SubagentPanel({
  isOpen,
  onClose,
  onViewSession,
}: {
  isOpen: boolean;
  onClose: () => void;
  onViewSession?: (sessionKey: string) => void;
}) {
  const { data: subagents, isLoading, refetch } = useSubagents();
  const spawnSubagent = useSpawnSubagent();
  const killSubagent = useKillSubagent();
  const [newTask, setNewTask] = useState("");
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [selectedSubagent, setSelectedSubagent] = useState<Subagent | null>(null);
  const subagentRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (event) => {
        if (!event || typeof event !== "object") return;
        if (event.type !== "status" && event.type !== "task_completed") return;
        if (subagentRefreshTimerRef.current !== null) {
          window.clearTimeout(subagentRefreshTimerRef.current);
        }
        subagentRefreshTimerRef.current = window.setTimeout(() => {
          void refetch();
          subagentRefreshTimerRef.current = null;
        }, 800);
      },
    });
    return () => {
      disconnect();
      if (subagentRefreshTimerRef.current !== null) {
        window.clearTimeout(subagentRefreshTimerRef.current);
        subagentRefreshTimerRef.current = null;
      }
    };
  }, [refetch]);

  const handleSpawn = async () => {
    if (!newTask.trim()) return;
    await spawnSubagent.mutateAsync({ task: newTask, label: `Task: ${newTask.slice(0, 30)}...` });
    setNewTask("");
    setShowSpawnModal(false);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="w-72 glass-strong border-l border-white/5 flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 accent-text" />
            <h3 className="text-sm font-medium text-white">Subagents</h3>
            {subagents && subagents.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-gray-400">
                {subagents.length}
              </span>
            )}
          </div>
          <div className="flex items-center">
            <button
              onClick={() => setShowSpawnModal(true)}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading...</p>
            </div>
          ) : subagents?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Zap className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No active subagents</p>
              <button
                onClick={() => setShowSpawnModal(true)}
                className="mt-3 text-[12px] px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Spawn New
              </button>
            </div>
          ) : (
            subagents?.map((subagent: Subagent) => (
              <div
                key={subagent.id}
                className="p-2.5 rounded-lg bg-white/[0.03] border border-white/5 hover:border-white/15 transition-all cursor-pointer group"
                onClick={() => setSelectedSubagent(subagent)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-white truncate font-medium">{subagent.label}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {new Date(subagent.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant={
                        subagent.status === "completed"
                          ? "success"
                          : subagent.status === "failed"
                            ? "error"
                            : subagent.status === "killed"
                              ? "default"
                              : "default"
                      }
                      size="sm"
                    >
                      {subagent.status}
                    </Badge>
                    {subagent.status === "running" && (
                      <button
                        className="p-1 rounded hover:bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          void killSubagent.mutateAsync(subagent.id);
                        }}
                      >
                        <Square className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Modal
        isOpen={showSpawnModal}
        onClose={() => setShowSpawnModal(false)}
        title="Spawn Subagent"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Task Description</label>
            <textarea
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Describe the task for the subagent..."
              className="w-full h-32 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <GlassButton variant="ghost" onClick={() => setShowSpawnModal(false)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              onClick={handleSpawn}
              disabled={!newTask.trim() || spawnSubagent.isPending}
            >
              {spawnSubagent.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              Spawn Subagent
            </GlassButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!selectedSubagent}
        onClose={() => setSelectedSubagent(null)}
        title={selectedSubagent?.label || "Subagent Details"}
        size="lg"
      >
        {selectedSubagent && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[12px] text-gray-500 mb-1">Status</p>
                <Badge
                  variant={
                    selectedSubagent.status === "completed"
                      ? "success"
                      : selectedSubagent.status === "failed"
                        ? "error"
                        : selectedSubagent.status === "running"
                          ? "default"
                          : "default"
                  }
                >
                  {selectedSubagent.status}
                </Badge>
              </div>
              <div>
                <p className="text-[12px] text-gray-500 mb-1">Created</p>
                <p className="text-sm text-white">
                  {new Date(selectedSubagent.createdAt).toLocaleString()}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[12px] text-gray-500 mb-1">Task</p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{selectedSubagent.task}</p>
              </div>
            </div>

            {selectedSubagent.result && (
              <div>
                <p className="text-[12px] text-gray-500 mb-1">Result</p>
                <div
                  className={`p-3 rounded-lg border ${
                    selectedSubagent.status === "completed"
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : "bg-red-500/10 border-red-500/30"
                  }`}
                >
                  <pre className="text-sm text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
                    {typeof selectedSubagent.result === "string"
                      ? selectedSubagent.result
                      : JSON.stringify(selectedSubagent.result, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            <div>
              <p className="text-[12px] text-gray-500 mb-1">Session Key</p>
              <code className="text-[12px] text-amber-400 bg-black/30 px-2 py-1 rounded">
                {selectedSubagent.sessionKey}
              </code>
            </div>

            <div>
              <p className="text-[12px] text-gray-500 mb-1">ID</p>
              <code className="text-[12px] text-gray-400 bg-black/30 px-2 py-1 rounded">
                {selectedSubagent.id}
              </code>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
              {onViewSession && (
                <button
                  className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all"
                  onClick={() => {
                    onViewSession(selectedSubagent.sessionKey);
                    setSelectedSubagent(null);
                  }}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  View Session
                </button>
              )}
              {selectedSubagent.status === "running" && (
                <button
                  className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-50"
                  onClick={async () => {
                    await killSubagent.mutateAsync(selectedSubagent.id);
                    setSelectedSubagent(null);
                  }}
                  disabled={killSubagent.isPending}
                >
                  {killSubagent.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Square className="w-4 h-4 mr-2" />
                  )}
                  Kill
                </button>
              )}
              <button
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                onClick={() => setSelectedSubagent(null)}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function SessionsPanel({
  isOpen,
  onClose,
  currentSessionId,
  activeSessionIds,
  currentSessionLoading,
  onLoadSession,
  onNewSession,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentSessionId: string | null;
  activeSessionIds: string[];
  currentSessionLoading: boolean;
  onLoadSession: (
    sessionId: string,
    messages: ChatMessage[],
    workspaceDir?: string | null,
    agentId?: string | null
  ) => void;
  onNewSession: () => void;
}) {
  const { data: sessions, isLoading, refetch } = useSessions();
  const deleteSession = useDeleteSession();
  const loadSession = useLoadSession();
  const renameSession = useRenameSession();
  const pinSession = usePinSession();
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const sessionsRefreshTimerRef = useRef<number | null>(null);

  // Pinned first, then most-recently-updated. Client-side safeguard so order is
  // correct even if the API response arrives unsorted, plus title/preview search.
  const visibleSessions = useMemo(() => {
    const list = Array.isArray(sessions) ? [...sessions] : [];
    const query = deferredSearchQuery.trim().toLowerCase();
    const filtered = query
      ? list.filter((session) => {
          const title = typeof session.title === "string" ? session.title.toLowerCase() : "";
          const preview = sessionPreviewText(session.last_message?.content)?.toLowerCase() || "";
          return title.includes(query) || preview.includes(query) || session.id.includes(query);
        })
      : list;
    return filtered.sort((a, b) => {
      const pinnedDelta = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pinnedDelta !== 0) return pinnedDelta;
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });
  }, [sessions, deferredSearchQuery]);

  const handleTogglePin = useCallback(
    (event: React.MouseEvent, sessionId: string, pinned: boolean) => {
      event.stopPropagation();
      void pinSession.mutateAsync({ sessionId, pinned: !pinned }).catch((error) => {
        console.error("Failed to toggle pin:", error);
      });
    },
    [pinSession]
  );

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (event) => {
        if (!event || typeof event !== "object") return;
        if (
          event.type !== "status" &&
          event.type !== "snapshot" &&
          event.type !== "task_completed"
        ) {
          return;
        }
        if (sessionsRefreshTimerRef.current !== null) {
          window.clearTimeout(sessionsRefreshTimerRef.current);
        }
        sessionsRefreshTimerRef.current = window.setTimeout(() => {
          void refetch();
          sessionsRefreshTimerRef.current = null;
        }, 600);
      },
    });

    return () => {
      disconnect();
      if (sessionsRefreshTimerRef.current !== null) {
        window.clearTimeout(sessionsRefreshTimerRef.current);
        sessionsRefreshTimerRef.current = null;
      }
    };
  }, [refetch]);

  const handleLoadSession = async (sessionId: string) => {
    try {
      const result = await loadSession.mutateAsync(sessionId);
      if (result?.messagesList) {
        onLoadSession(
          sessionId,
          result.messagesList as ChatMessage[],
          (result as { workspace_dir?: string | null }).workspace_dir || null,
          (result as { agent_id?: string | null }).agent_id || null
        );
      }
    } catch (error) {
      console.error("Failed to load session:", error);
    }
  };

  const beginRenameSession = (
    event: React.MouseEvent,
    session: { id: string; title?: string | null }
  ) => {
    event.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(
      typeof session.title === "string" && session.title.trim()
        ? session.title.trim()
        : `Session ${session.id.slice(0, 8)}`
    );
  };

  const cancelRenameSession = () => {
    setEditingSessionId(null);
    setEditingTitle("");
  };

  const submitRenameSession = async (sessionId: string) => {
    const nextTitle = editingTitle.trim();
    if (!nextTitle) return;
    try {
      await renameSession.mutateAsync({ sessionId, title: nextTitle });
      setEditingSessionId(null);
      setEditingTitle("");
      await refetch();
    } catch (error) {
      console.error("Failed to rename session:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="w-72 glass-strong border-r border-white/5 flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 accent-text" />
            <h3 className="text-sm font-medium text-white">Sessions</h3>
            {sessions && sessions.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-gray-400">
                {sessions.length}
              </span>
            )}
          </div>
          <div className="flex items-center">
            <button
              onClick={onNewSession}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {sessions && sessions.length > 0 && (
          <div className="px-3 py-2 border-b border-white/5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search sessions..."
                className="w-full rounded-lg border border-white/10 bg-black/30 pl-8 pr-7 py-1.5 text-[12px] text-white placeholder:text-gray-600 !outline-none focus:border-indigo-400/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          <button
            onClick={onNewSession}
            className="w-full p-2.5 rounded-lg bg-[rgba(var(--accent-primary),0.1)] border border-[rgba(var(--accent-primary),0.2)] hover:bg-[rgba(var(--accent-primary),0.15)] text-white text-[12px] font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Session
          </button>

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading...</p>
            </div>
          ) : sessions?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No sessions yet</p>
              <p className="text-[10px] mt-1 text-gray-600">Start chatting to create one</p>
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No matching sessions</p>
              <p className="text-[10px] mt-1 text-gray-600">Try a different search</p>
            </div>
          ) : (
            visibleSessions.map((session) => {
              const displayTitle = sessionDisplayTitle(session as Record<string, unknown>);
              const routeLabel = sessionRouteLabel(session as Record<string, unknown>);
              const previewText = sessionPreviewText(session.last_message?.content);
              const isSessionActive =
                activeSessionIds.includes(session.id) ||
                (currentSessionLoading && currentSessionId === session.id);
              return (
                <div
                  key={session.id}
                  className={`deferred-list-row relative p-2.5 rounded-lg transition-all cursor-pointer group ${
                    currentSessionId === session.id
                      ? "bg-[rgba(var(--accent-primary),0.12)] border border-[rgba(var(--accent-primary),0.3)]"
                      : "bg-white/[0.03] border border-white/5 hover:border-white/15"
                  }`}
                  onClick={() => handleLoadSession(session.id)}
                >
                  <div className="min-w-0 w-full">
                    <div className="min-w-0 w-full">
                      {editingSessionId === session.id ? (
                        <div
                          className="flex items-center gap-1.5"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            value={editingTitle}
                            autoFocus
                            onChange={(event) => setEditingTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void submitRenameSession(session.id);
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                cancelRenameSession();
                              }
                            }}
                            className="min-w-0 flex-1 rounded-md border border-white/20 bg-black/40 px-2 py-1 text-[12px] text-white !outline-none focus:border-indigo-400/50"
                          />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void submitRenameSession(session.id);
                            }}
                            disabled={renameSession.isPending}
                            className="p-1 rounded hover:bg-emerald-500/20 text-emerald-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Save title"
                          >
                            {renameSession.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              cancelRenameSession();
                            }}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                            title="Cancel rename"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <p className="text-[12px] text-white font-medium flex w-full min-w-0 items-center gap-1.5">
                          {isSessionActive ? (
                            <Loader2 className="w-3 h-3 animate-spin text-amber-400 flex-shrink-0" />
                          ) : (
                            currentSessionId === session.id && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                            )
                          )}
                          {session.pinned && (
                            <Pin className="w-3 h-3 text-amber-400 flex-shrink-0 fill-amber-400/30" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
                        </p>
                      )}
                      <p className="text-[10px] text-gray-500 mt-0.5 flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
                        <span className="flex-shrink-0">{session.message_count || 0} messages</span>
                        {routeLabel && (
                          <>
                            <span className="flex-shrink-0 text-gray-700">·</span>
                            <span className="min-w-0 flex-1 truncate" title={routeLabel}>
                              {routeLabel}
                            </span>
                          </>
                        )}
                        {(session.updated_at || session.created_at) && (
                          <>
                            <span className="flex-shrink-0 text-gray-700">·</span>
                            <span
                              className="flex-shrink-0"
                              title={new Date(
                                session.updated_at || session.created_at
                              ).toLocaleString()}
                            >
                              {formatRelativeTime(session.updated_at || session.created_at)}
                            </span>
                          </>
                        )}
                      </p>
                      {typeof (session as { workspace_dir?: string | null }).workspace_dir ===
                        "string" && (
                        <p className="text-[10px] text-blue-300/90 mt-0.5 truncate">
                          {(session as { workspace_dir?: string }).workspace_dir}
                        </p>
                      )}
                      {previewText && (
                        <p
                          className="text-[10px] text-gray-500 mt-0.5 w-full truncate"
                          title={previewText}
                        >
                          {previewText}
                        </p>
                      )}
                    </div>
                    {editingSessionId !== session.id && (
                      <div
                        className={cn(
                          "pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-md bg-[#11111a]/90 px-1 py-0.5 shadow-lg shadow-black/30 backdrop-blur transition-opacity",
                          "opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                        )}
                      >
                        <button
                          className={cn(
                            "p-1 rounded cursor-pointer",
                            session.pinned
                              ? "text-amber-400 hover:bg-amber-500/20"
                              : "text-gray-400 hover:bg-amber-500/20 hover:text-amber-300"
                          )}
                          onClick={(event) => handleTogglePin(event, session.id, !!session.pinned)}
                          aria-label={session.pinned ? "Unpin session" : "Pin session"}
                          title={session.pinned ? "Unpin session" : "Pin session"}
                        >
                          {session.pinned ? (
                            <PinOff className="w-3 h-3" />
                          ) : (
                            <Pin className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          className="p-1 rounded hover:bg-indigo-500/20 text-indigo-300 cursor-pointer"
                          onClick={(event) => beginRenameSession(event, session)}
                          aria-label="Rename session"
                          title="Rename session"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-red-500/20 text-red-400 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDeleteModal(session.id);
                          }}
                          aria-label="Delete session"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <Modal
        isOpen={!!showDeleteModal}
        onClose={() => setShowDeleteModal(null)}
        title="Delete Session"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-300">
            Are you sure you want to delete this session? This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <GlassButton variant="ghost" onClick={() => setShowDeleteModal(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30"
              onClick={async () => {
                if (showDeleteModal) {
                  await deleteSession.mutateAsync(showDeleteModal);
                  setShowDeleteModal(null);
                }
              }}
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </GlassButton>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Banner showing pending tool-approval requests with resolve buttons. */
function PendingApprovalsBanner() {
  const [approvals, setApprovals] = useState<
    Array<{ id: string; toolName: string; argsSummary: string; createdAt: number }>
  >([]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await apiFetch("/api/tools/approvals");
        const data = await res.json();
        if (active && Array.isArray(data.pending)) {
          setApprovals(data.pending);
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const resolve = async (requestId: string, decision: string) => {
    try {
      await apiFetch("/api/tools/approvals/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
      });
      setApprovals((prev) => prev.filter((a) => a.id !== requestId));
    } catch {
      /* ignore */
    }
  };

  if (approvals.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-b border-amber-500/30 bg-amber-500/10">
      {approvals.map((req) => (
        <div key={req.id} className="flex items-center gap-2 text-sm">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-200">
            <span className="font-medium">{req.toolName}</span>
            <span className="text-amber-200/60 ml-2 truncate">{req.argsSummary}</span>
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => resolve(req.id, "approve_once")}
              className="rounded px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
            >
              Allow once
            </button>
            <button
              type="button"
              onClick={() => resolve(req.id, "approve_session")}
              className="rounded px-2 py-0.5 text-xs bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors"
            >
              Allow session
            </button>
            <button
              type="button"
              onClick={() => resolve(req.id, "deny")}
              className="rounded px-2 py-0.5 text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Chat() {
  const navigate = useNavigate();
  const { data: agents = [] } = useAgents();
  const stopAgent = useStopAgent();
  const { data: info } = useInfo();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [sessionAgentId, setSessionAgentId] = useState<string | null>(null);
  const [lastWorkspaceDir, setLastWorkspaceDir] = useState<string | null>(null);
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
  } = useChat(selectedAgentId);
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
  const [input, setInput] = useState("");
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);
  const [reverting, setReverting] = useState(false);
  const [showSubagentPanel, setShowSubagentPanel] = useState(false);
  const [showSessionsPanel, setShowSessionsPanel] = useState(true);
  const [showDiffPanel, setShowDiffPanel] = useState(false);
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
  const [liveStatus, setLiveStatus] = useState<"thinking" | "generating" | "idle">("idle");
  const [liveActivities, setLiveActivities] = useState<LiveActivityItem[]>([]);
  const [liveCurrentStep, setLiveCurrentStep] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [dictationSupported, setDictationSupported] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [dictationTranscribing, setDictationTranscribing] = useState(false);
  const [composerHeight, setComposerHeight] = useState(88);
  const [messageProcessMap, setMessageProcessMap] = useState<Record<string, LiveActivityItem[]>>(
    () => readPersistedMessageProcessMap()
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationChunksRef = useRef<Blob[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const diffPanelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const diffPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const acceptEventsUntilRef = useRef(0);
  const pendingProcessCaptureRef = useRef<PendingProcessCapture | null>(null);
  const runActivityBufferRef = useRef<LiveActivityItem[]>([]);
  const latestStatusTimestampBySessionRef = useRef<Record<string, number>>({});
  const homeWorkspaceDir =
    typeof info?.homeDir === "string" && info.homeDir.trim().length > 0
      ? info.homeDir.trim()
      : null;
  const fallbackWorkspaceDir =
    !sessionId && (lastWorkspaceDir || homeWorkspaceDir)
      ? lastWorkspaceDir || homeWorkspaceDir
      : null;
  const effectiveWorkspaceDir = workspaceDir || fallbackWorkspaceDir || null;
  const sessionFileChanges = useMemo(
    () => summarizeSessionFileChanges(typedMessages),
    [typedMessages]
  );
  const resolveSelectableSessionAgentId = useCallback(
    (agentId?: string | null): string | undefined => {
      if (typeof agentId !== "string") return undefined;
      const trimmed = agentId.trim();
      if (!trimmed || trimmed === "default") return undefined;
      return agents.some((agent) => agent.id === trimmed) ? trimmed : undefined;
    },
    [agents]
  );
  const syncSessionAgentSelection = useCallback(
    (agentId?: string | null) => {
      const normalized = typeof agentId === "string" && agentId.trim() ? agentId.trim() : null;
      setSessionAgentId(normalized);
      setSelectedAgentId(resolveSelectableSessionAgentId(normalized));
    },
    [resolveSelectableSessionAgentId]
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
    persistSessionId(sessionId);
  }, [sessionId]);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      setDictationSupported(false);
      return;
    }
    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    const canRecordAudio =
      !!window.navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    setDictationSupported(!!SpeechCtor || canRecordAudio);
  }, []);

  useEffect(() => {
    return () => {
      diffPanelResizeCleanupRef.current?.();
      diffPanelResizeCleanupRef.current = null;
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (dictationStreamRef.current) {
        for (const track of dictationStreamRef.current.getTracks()) {
          track.stop();
        }
        dictationStreamRef.current = null;
      }
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const refreshScrollToBottomVisibility = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || artifactViewerTarget) {
      setShowScrollToBottomButton(false);
      return;
    }
    const scrolledUp = container.scrollTop + container.clientHeight < container.scrollHeight - 1;
    setShowScrollToBottomButton(scrolledUp);
  }, [artifactViewerTarget]);

  useEffect(() => {
    scrollToBottom();
    setShowScrollToBottomButton(false);
  }, [messages]);

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
          // Reset timeout window at completion so long runs don't expire before attach.
          createdAt: Date.now(),
        };
      } else if (runActivities.length > 0) {
        // Keep the working timeline visible until the next assistant message is attached.
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
      // Fallback: attach to the newest assistant message produced around this capture window.
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
    const captureActivities = mergeActivityLists(
      mergeActivityLists(pending.activities, runActivityBufferRef.current),
      liveActivities
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
      if (isGenericStatusLabel(normalizedText)) return;
      const nextTimestamp =
        typeof eventTimestamp === "number" && Number.isFinite(eventTimestamp)
          ? eventTimestamp
          : Date.now();
      const normalizedToolName = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
      const normalizedToolCallId =
        typeof toolCallId === "string" && toolCallId.trim() ? toolCallId.trim().toLowerCase() : "";
      const normalizedSandboxProvider = normalizeSandboxProviderValue(sandboxProvider);
      const nextId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

          for (let index = previous.length - 1; index >= 0; index -= 1) {
            const candidate = previous[index];
            if (candidate.phase !== "start") continue;
            if (nextTimestamp - candidate.timestamp > 60_000) continue;
            if (normalizeActivityTextForPhase(candidate.text, phase) !== normalizedText) continue;
            const updated = [...previous];
            updated[index] = {
              ...candidate,
              phase,
              text: normalizedText,
              timestamp: nextTimestamp,
              toolName: normalizedToolName || candidate.toolName,
              toolCallId: normalizedToolCallId || candidate.toolCallId,
              sandboxProvider: normalizedSandboxProvider || candidate.sandboxProvider,
            };
            return sortAndMergeActivities(updated);
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
          id: nextId,
          phase,
          text: normalizedText,
          timestamp: nextTimestamp,
          toolName: normalizedToolName || undefined,
          toolCallId: normalizedToolCallId || undefined,
          sandboxProvider: normalizedSandboxProvider,
        };
        return sortAndMergeActivities([...previous, next]);
      };

      runActivityBufferRef.current = applyActivityEvent(runActivityBufferRef.current);
      setLiveActivities((previous) => applyActivityEvent(previous));
    },
    []
  );

  const hydrateSessionStatus = useCallback(async (targetSessionId?: string | null) => {
    const resolvedSessionId =
      typeof targetSessionId === "string" && targetSessionId.trim().length > 0
        ? targetSessionId.trim()
        : null;

    try {
      const response = await chatApi.getSessionStatus(resolvedSessionId || undefined);
      if (!response.success || !response.data) return;
      const payload = response.data as SessionStatusResponse;
      const rawActiveIds = Array.isArray(payload.activeSessionIds) ? payload.activeSessionIds : [];

      if (!resolvedSessionId) return;
      const snapshot = payload.session;
      const snapshotAgeMs =
        snapshot && typeof snapshot.timestamp === "number"
          ? Date.now() - snapshot.timestamp
          : Infinity;
      const snapshotFresh = snapshotAgeMs <= SESSION_ACTIVITY_STALE_MS;
      const nextActiveIds =
        snapshot && !snapshotFresh
          ? rawActiveIds.filter((candidateId) => candidateId !== resolvedSessionId)
          : rawActiveIds;
      setActiveSessionIds(nextActiveIds);
      const isActive =
        !!snapshot &&
        snapshotFresh &&
        (payload.active === true ||
          snapshot.status === "thinking" ||
          snapshot.status === "generating" ||
          snapshot.status === "tool_executing" ||
          snapshot.status === "tool_completed");

      if (!isActive || !snapshot) {
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
        return;
      }

      if (activeSessionRef.current !== resolvedSessionId) return;
      const snapshotLatestTimestamp = (() => {
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
      })();
      const latestKnownTimestamp =
        latestStatusTimestampBySessionRef.current[resolvedSessionId] || 0;
      if (
        snapshotLatestTimestamp > 0 &&
        latestKnownTimestamp > 0 &&
        snapshotLatestTimestamp + 25 < latestKnownTimestamp
      ) {
        return;
      }
      if (snapshotLatestTimestamp > latestKnownTimestamp) {
        latestStatusTimestampBySessionRef.current[resolvedSessionId] = snapshotLatestTimestamp;
      }
      const normalizedSnapshotStatus = normalizeSessionStatus(snapshot.status);
      setLiveStatus(normalizedSnapshotStatus);
      const snapshotActivities = normalizeSnapshotActivities(
        mergeActivityLists([], toLiveActivityItems(snapshot.activities)),
        snapshot.status
      );
      const shouldPreserveLocalActivities =
        snapshotActivities.length === 0 &&
        runActivityBufferRef.current.length > 0 &&
        normalizedSnapshotStatus !== "idle";
      if (!shouldPreserveLocalActivities) {
        setLiveActivities(snapshotActivities);
        runActivityBufferRef.current = snapshotActivities.map((activity) => ({ ...activity }));
      }
      const activeStep = getLatestInFlightStep(snapshotActivities);
      if (activeStep && !isGenericStatusLabel(activeStep)) {
        setLiveCurrentStep(activeStep);
      } else {
        const detail = typeof snapshot.detail === "string" ? snapshot.detail.trim() : "";
        if (isMeaningfulThoughtDetail(detail)) {
          setLiveCurrentStep(detail);
        } else if (normalizedSnapshotStatus === "generating") {
          setLiveCurrentStep("Generating response...");
        } else if (normalizedSnapshotStatus === "thinking") {
          setLiveCurrentStep("Thinking...");
        } else {
          setLiveCurrentStep(null);
        }
      }
    } catch (error) {
      console.error("Failed to hydrate session status:", error);
    }
  }, []);

  useEffect(() => {
    setLiveStatus("idle");
    setLiveActivities([]);
    setStreamingContent(null);
    setLiveCurrentStep(null);
    runActivityBufferRef.current = [];
    acceptEventsUntilRef.current = 0;
    if (!sessionId) {
      return;
    }

    void hydrateSessionStatus(sessionId);
    return;
  }, [hydrateSessionStatus, sessionId]);

  useEffect(() => {
    const disconnect = connectStatusStream({
      onEvent: (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "snapshot") {
          const snapshotIds = Array.isArray(payload.activeSessionIds)
            ? payload.activeSessionIds.filter(
                (candidate): candidate is string =>
                  typeof candidate === "string" && candidate.trim().length > 0
              )
            : [];
          setActiveSessionIds(snapshotIds);
          const activeSession = activeSessionRef.current;
          if (activeSession) {
            void hydrateSessionStatus(activeSession);
          }
          return;
        }
        if (payload.type !== "status") {
          // Token streaming: accumulate assistant text deltas for live display.
          if (payload.type === "assistant_token") {
            const delta = typeof payload.delta === "string" ? payload.delta : "";
            if (delta) {
              const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
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
        const payloadSessionId =
          typeof payload.sessionId === "string" && payload.sessionId.trim()
            ? payload.sessionId
            : null;
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
          if (
            status === "thinking" ||
            status === "generating" ||
            status === "tool_executing" ||
            status === "tool_completed"
          ) {
            setActiveSessionIds((previous) =>
              previous.includes(payloadSessionId) ? previous : [...previous, payloadSessionId]
            );
          }
          if (status === "idle" || status === "error") {
            setActiveSessionIds((previous) => previous.filter((id) => id !== payloadSessionId));
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

        if (status === "thinking") {
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
        if (status === "idle") {
          setLiveStatus("idle");
          setLiveCurrentStep(null);
          const pendingCapture = pendingProcessCaptureRef.current;
          const hasPendingCaptureForVisibleSession =
            !!pendingCapture &&
            (!payloadSessionId ||
              !pendingCapture.sessionId ||
              pendingCapture.sessionId === payloadSessionId);
          if (!loadingRef.current && !hasPendingCaptureForVisibleSession) {
            setStreamingContent(null);
            setLiveActivities([]);
            runActivityBufferRef.current = [];
          }
          return;
        }
        if (status === "tool_executing" || status === "tool_completed" || status === "error") {
          const phase: "start" | "result" | "error" =
            status === "tool_executing"
              ? "start"
              : status === "tool_completed"
                ? "result"
                : "error";
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
  }, [appendLiveActivity, hydrateSessionStatus]);

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

  const handleSend = async () => {
    const sessionCurrentlyActive = !!sessionId && activeSessionIds.includes(sessionId);
    if (!input.trim() || isLoading || sessionCurrentlyActive) return;
    const message = input;
    setInput("");
    const response = await sendMessage(message, {
      workspaceDir: effectiveWorkspaceDir || undefined,
    });
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
  };

  useEffect(() => {
    if (!streamingContent || isLoading) return;
    const latestMessage = typedMessages[typedMessages.length - 1];
    if (latestMessage?.role === "assistant") {
      setStreamingContent(null);
    }
  }, [isLoading, streamingContent, typedMessages]);

  const handleStopActive = useCallback(async () => {
    const activeAgentId = selectedAgentId || sessionAgentId;
    stopGenerating();
    if (activeAgentId) {
      try {
        await stopAgent.mutateAsync(activeAgentId);
      } catch (error) {
        console.error("Failed to stop active agent:", error);
      }
    }
    if (sessionId) {
      setActiveSessionIds((previous) => previous.filter((id) => id !== sessionId));
    }
    setLiveStatus("idle");
    setLiveCurrentStep(null);
    setLiveActivities([]);
    setLoadingSessionId(null);
    runActivityBufferRef.current = [];
    pendingProcessCaptureRef.current = null;
  }, [selectedAgentId, sessionAgentId, stopGenerating, stopAgent, sessionId]);

  const handleToggleDictation = useCallback(async () => {
    if (!dictationSupported || typeof window === "undefined") return;
    const appendDictationText = (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      setInput((previous) => {
        const trimmed = previous.trimEnd();
        return trimmed.length > 0 ? `${trimmed} ${normalized}` : normalized;
      });
    };

    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (SpeechCtor) {
      if (!speechRecognitionRef.current) {
        const recognition = new SpeechCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
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
          console.error("Dictation error:", event?.error || "unknown");
          setDictating(false);
        };
        recognition.onend = () => {
          setDictating(false);
        };
        speechRecognitionRef.current = recognition;
      }

      const recognition = speechRecognitionRef.current;
      if (!recognition) return;
      if (dictating) {
        recognition.stop();
        setDictating(false);
        return;
      }
      try {
        recognition.start();
        setDictating(true);
      } catch (error) {
        console.error("Failed to start dictation:", error);
        setDictating(false);
      }
      return;
    }

    const canRecordAudio =
      !!window.navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    if (!canRecordAudio) return;

    if (dictationTranscribing) return;

    if (dictating) {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      return;
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
      dictationStreamRef.current = stream;
      dictationChunksRef.current = [];

      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const selectedMimeType = mimeCandidates.find((candidate) =>
        window.MediaRecorder.isTypeSupported(candidate)
      );
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
          const blob = new Blob(chunks, { type: recorderMimeType });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          const chunkSize = 0x8000;
          for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
          }
          const audioBase64 = btoa(binary);
          const response = await chatApi.dictate({
            audioBase64,
            mimeType: recorderMimeType,
            fileName: "dictation.webm",
          });
          if (response.success && response.data?.text) {
            appendDictationText(response.data.text);
          } else {
            console.error(
              "Dictation transcription failed:",
              response.error || "No transcript was returned"
            );
          }
        } catch (error) {
          console.error("Dictation transcription error:", error);
        } finally {
          setDictationTranscribing(false);
        }
      };

      recorder.start(250);
      setDictating(true);
    } catch (error) {
      console.error("Failed to start dictation recording:", error);
      setDictating(false);
      setDictationTranscribing(false);
      if (dictationStreamRef.current) {
        for (const track of dictationStreamRef.current.getTracks()) {
          track.stop();
        }
        dictationStreamRef.current = null;
      }
    }
  }, [dictating, dictationSupported, dictationTranscribing]);

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
    try {
      let selectedPath: string | null = null;

      if (isDesktopHostRuntime()) {
        selectedPath = await openDesktopDirectoryDialog({
          defaultPath: effectiveWorkspaceDir || undefined,
          title: "Select Session Workspace",
        });
      } else {
        const manual = window.prompt("Enter workspace folder path", effectiveWorkspaceDir || "");
        if (typeof manual === "string" && manual.trim()) {
          selectedPath = manual.trim();
        }
      }

      if (selectedPath) {
        await applySessionWorkspace(selectedPath);
      }
    } catch (error) {
      console.error("Failed to select workspace:", error);
      if (typeof window !== "undefined") {
        const manual = window.prompt(
          "Unable to open native folder picker. Enter workspace folder path manually:",
          effectiveWorkspaceDir || ""
        );
        if (typeof manual === "string" && manual.trim()) {
          await applySessionWorkspace(manual.trim());
        }
      }
    }
  }, [applySessionWorkspace, effectiveWorkspaceDir]);

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
    (event: React.MouseEvent<HTMLButtonElement>) => {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
    const params = new URLSearchParams(window.location.search);
    const sessionParamRaw = params.get("session");
    const sessionParam =
      typeof sessionParamRaw === "string" && sessionParamRaw.trim().length > 0
        ? sessionParamRaw.trim()
        : null;
    const persistedSessionId = readPersistedSessionId();
    const initialSessionId = sessionParam || persistedSessionId;

    if (initialSessionId && initialSessionId !== sessionId) {
      loadSessionMutation
        .mutateAsync(initialSessionId)
        .then((result) => {
          if (result?.messagesList) {
            loadSession(
              initialSessionId,
              result.messagesList as ChatMessage[],
              (result as { workspace_dir?: string | null }).workspace_dir || null
            );
            syncSessionAgentSelection((result as { agent_id?: string | null }).agent_id || null);
            if (sessionParam) {
              window.history.replaceState({}, "", "/chat");
            }
          }
        })
        .catch((error) => {
          console.error("Failed to restore initial chat session:", error);
          if (!sessionParam) {
            persistSessionId(null);
          }
        });
    }
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
      <PendingApprovalsBanner />
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/5 bg-[#0a0a0f]/90 backdrop-blur-xl flex-shrink-0">
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
          <h1 className="text-sm sm:text-base font-semibold text-white">Chat</h1>
          {sessionId && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-mono">
                {sessionId.slice(0, 6)}...
              </span>
            </div>
          )}
          {effectiveWorkspaceDir && (
            <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/30">
              <Folder className="w-3 h-3 text-blue-300" />
              <span className="text-[10px] text-blue-300 font-mono">
                {formatWorkspaceLabel(effectiveWorkspaceDir, 30)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <select
            value={selectedAgentId || ""}
            onChange={(e) => setSelectedAgentId(e.target.value || undefined)}
            className="text-[12px] bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white !outline-none focus:border-white/20 cursor-pointer"
          >
            <option value="">Default</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void handleSelectWorkspace()}
            disabled={workspaceSaving}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-[12px] text-gray-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            title="Select workspace folder for this session"
          >
            {workspaceSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5" />
            )}
            <span className="hidden lg:inline">
              {effectiveWorkspaceDir
                ? formatWorkspaceLabel(effectiveWorkspaceDir, 40)
                : "Select Workspace"}
            </span>
          </button>
          {workspaceDir && (
            <button
              type="button"
              onClick={() => void applySessionWorkspace(null)}
              disabled={workspaceSaving}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              title="Clear session workspace"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setShowDiffPanel(!showDiffPanel)}
            className={cn(
              "relative p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
              showDiffPanel ? "text-indigo-300" : "text-gray-500"
            )}
            title="File diffs"
          >
            <FileText className="w-4 h-4" />
            {sessionFileChanges && sessionFileChanges.files.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] rounded-full bg-indigo-500/80 px-1 text-[9px] leading-[15px] text-white text-center">
                {sessionFileChanges.files.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSubagentPanel(!showSubagentPanel)}
            className={cn(
              "p-1.5 sm:p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer",
              showSubagentPanel ? "text-amber-400" : "text-gray-500"
            )}
            title="Subagents"
          >
            <Zap className="w-4 h-4" />
          </button>
          {showWorkingTimeline && (
            <button
              onClick={() => void handleStopActive()}
              disabled={stopAgent.isPending}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              title="Stop active run"
            >
              {stopAgent.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            onClick={clearChat}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
            title="Clear Chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
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
            onLoadSession={(id, msgs, loadedWorkspaceDir, loadedAgentId) => {
              loadSession(id, msgs, loadedWorkspaceDir);
              syncSessionAgentSelection(loadedAgentId);
            }}
            onNewSession={() => {
              clearChat();
              setSessionAgentId(null);
              setSelectedAgentId(undefined);
            }}
          />
        )}

        <div className="relative flex-1 flex flex-col min-w-0">
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
                      {effectiveWorkspaceDir && (
                        <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5">
                          <Folder className="h-3.5 w-3.5 text-blue-300" />
                          <span className="text-[12px] text-blue-200 font-mono">
                            Workspace: {effectiveWorkspaceDir}
                          </span>
                        </div>
                      )}
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
                    const mergedActivities = mergeActivityLists(
                      restoredProcessActivities,
                      fallbackToolActivities
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
                        <div
                          className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            message.role === "user"
                              ? "bg-[rgba(var(--accent-primary),0.2)]"
                              : "bg-emerald-500/20"
                          }`}
                        >
                          {message.role === "user" ? (
                            <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 accent-text" />
                          ) : (
                            <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
                          )}
                        </div>
                        <div
                          className={`max-w-[85%] sm:max-w-[75%] lg:max-w-[65%] ${message.role === "user" ? "text-right" : ""}`}
                        >
                          <div
                            className={`rounded-xl sm:rounded-2xl px-3 py-2 sm:px-4 sm:py-3 ${
                              message.role === "user"
                                ? "border border-[rgba(var(--accent-primary),0.2)]"
                                : "border border-white/5"
                            }`}
                          >
                            {message.role !== "user" && (
                              <AssistantMetaInline
                                message={message}
                                processActivities={processActivities}
                                sessionId={sessionId}
                                turnStartedAtMs={turnStartedAtMs}
                                onOpenArtifact={openArtifactViewer}
                                section="work"
                              />
                            )}
                            {hasAssistantToolCalls && (
                              <div className="my-2 border-t border-white/12" />
                            )}
                            <MessageContent content={message.content} />
                            {message.role === "user" && sessionId && (
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevertTarget({
                                      index: originalIndex,
                                      content: message.content,
                                      timestamp: message.timestamp,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[10px] text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                                  title="Revert session to this message"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Revert to here
                                </button>
                              </div>
                            )}
                            {message.role !== "user" && (
                              <AssistantMetaInline
                                message={message}
                                processActivities={processActivities}
                                sessionId={sessionId}
                                turnStartedAtMs={turnStartedAtMs}
                                onOpenArtifact={openArtifactViewer}
                                section="summary"
                              />
                            )}
                          </div>

                          {message.timestamp && (
                            <p className="text-[10px] text-gray-600 mt-1.5">
                              {formatRelativeTime(message.timestamp)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                {showWorkingTimeline && (
                  <div className="flex gap-3">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 sm:w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="max-w-[85%] sm:max-w-[75%] lg:max-w-[65%] px-0.5 py-0.5">
                      <LiveActivityTimeline
                        status={timelineStatus}
                        activities={timelineActivities}
                        currentStep={liveCurrentStep}
                      />
                    </div>
                  </div>
                )}
                {streamingContent && (
                  <div className="flex gap-3">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 sm:w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="max-w-[85%] sm:max-w-[75%] lg:max-w-[65%] rounded-2xl rounded-tl-sm bg-[#1a1e2b] border border-white/10 px-4 py-3">
                      <div className="text-sm text-gray-200 whitespace-pre-wrap break-words">
                        {streamingContent}
                        <span className="inline-block w-2 h-4 ml-0.5 bg-emerald-400/70 animate-pulse align-middle" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {showScrollToBottomButton && (
                <button
                  type="button"
                  onClick={() => {
                    scrollToBottom();
                    setShowScrollToBottomButton(false);
                  }}
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
                className="flex-shrink-0 px-3 sm:px-4 py-3 border-t border-white/5 bg-[#0a0a0f]/80 backdrop-blur-xl"
              >
                <div className="flex items-end gap-2 sm:gap-3">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 min-h-[42px] max-h-[220px] overflow-y-auto resize-none px-3 sm:px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-[12px] text-white placeholder-gray-500 !outline-none focus:border-white/20 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => void handleToggleDictation()}
                    disabled={!dictationSupported || showWorkingTimeline || dictationTranscribing}
                    className={cn(
                      "h-[42px] w-[42px] shrink-0 self-end inline-flex items-center justify-center rounded-xl border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                      dictating
                        ? "border-red-500/40 bg-red-500/20 text-red-300"
                        : "border-white/10 bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/[0.08]"
                    )}
                    title={
                      dictationSupported
                        ? dictationTranscribing
                          ? "Transcribing..."
                          : dictating
                            ? "Stop dictation"
                            : "Start dictation"
                        : "Dictation not supported in this browser/runtime"
                    }
                    aria-label={
                      dictationTranscribing
                        ? "Transcribing dictation"
                        : dictating
                          ? "Stop dictation"
                          : "Start dictation"
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
                  {showWorkingTimeline ? (
                    <button
                      type="button"
                      onClick={() => void handleStopActive()}
                      className="h-[42px] w-[42px] shrink-0 self-end inline-flex items-center justify-center rounded-xl border border-red-500/40 bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      disabled={stopAgent.isPending}
                      title="Stop active run"
                    >
                      {stopAgent.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      className="h-[42px] w-[42px] shrink-0 self-end inline-flex items-center justify-center rounded-xl accent-button disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {/* <div className="mt-1 px-1 text-[10px] text-gray-500">
                  Enter to send • Shift+Enter for newline
                </div> */}
              </div>
            </>
          )}
        </div>

        {!artifactViewerTarget && showDiffPanel && (
          <SessionDiffPanel
            isOpen={showDiffPanel}
            summary={sessionFileChanges}
            selectedPath={selectedDiffPath}
            onSelectPath={setSelectedDiffPath}
            onClose={() => setShowDiffPanel(false)}
            width={diffPanelWidth}
            onResizeStart={handleDiffPanelResizeStart}
            onOpenInIDE={handleOpenDiffFileInIde}
          />
        )}

        {!artifactViewerTarget && showSubagentPanel && (
          <SubagentPanel
            isOpen={showSubagentPanel}
            onClose={() => setShowSubagentPanel(false)}
            onViewSession={async (sessionKey) => {
              try {
                const result = await loadSessionMutation.mutateAsync(sessionKey);
                if (result?.messagesList) {
                  loadSession(
                    sessionKey,
                    result.messagesList as ChatMessage[],
                    (result as { workspace_dir?: string | null }).workspace_dir || null
                  );
                  syncSessionAgentSelection(
                    (result as { agent_id?: string | null }).agent_id || null
                  );
                  setShowSubagentPanel(false);
                }
              } catch (error) {
                console.error("Failed to load subagent session:", error);
              }
            }}
          />
        )}

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
              Are you sure you want to revert here? This will remove this message and{" "}
              {revertFollowingCount} following message{revertFollowingCount === 1 ? "" : "s"} from
              this session, then place this text back in the input box for resend.
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
