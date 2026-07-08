import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  isValidElement,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Send,
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
  CircleHelp,
  ShieldAlert,
  GripVertical,
  Paperclip,
} from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat, useLoadSession, useUpdateSessionAgent } from "@/hooks/useChat";
import {
  useAgents,
  useInfo,
  useSubagents,
  useSpawnSubagent,
  useKillSubagent,
  useStopAgent,
  type Subagent,
} from "@/hooks/useApi";
import { chatApi, providerPlansApi, settingsApi } from "@/lib/api";
import type {
  Agent,
  ChatImageAttachment,
  ProviderPlanSnapshot,
  ProviderPlanStatusResponse,
  SessionContextUsage,
} from "@/types";
import {
  MAX_CHAT_IMAGES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_TEXT_FILES,
  chatImageSrc,
  fileToChatImage,
  fileToTextAttachment,
  formatAttachedFiles,
  isSupportedImageType,
  isTextLikeFile,
  type ChatFileAttachment,
} from "@/lib/chatImages";
import { PageLayout } from "@/components/layout";
import { GlassCard, Input, Badge, Modal, Button } from "@/components/ui";
import { formatRelativeTime } from "@/lib/utils";
import {
  providerPlanUsageClasses,
  providerPlanWindowDisplay,
  providerPlanWindowSummary,
  type ProviderPlanWindowDisplay,
} from "@/lib/providerPlanDisplay";
import { useUIStore } from "@/stores/uiStore";
import { appendApiTokenParam, apiFetch } from "@/lib/auth";
import {
  connectStatusStream,
  type PendingChatMessage,
  type StatusSessionSnapshot,
  type StatusStreamStatusEvent,
  type StatusStreamTokenEvent,
} from "@/lib/status-stream";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  mergeActivityLists,
  type LiveActivityItem,
} from "@/lib/chatActivities";
import { preprocessChatMarkdown } from "@/lib/chatMarkdownPreprocessor";
import {
  clearCachedLiveSessionState,
  readCachedLiveSessionState,
  writeCachedLiveSessionState,
} from "./chat/liveSessionState";
import {
  clearCachedOptimisticPendingMessages,
  readCachedOptimisticPendingMessages,
  writeCachedOptimisticPendingMessages,
} from "./chat/pendingQueueCache";
import { mergePendingChatMessages, normalizePendingChatMessages } from "./chat/pendingQueueState";
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
  normalizeDictationMode,
  normalizeSessionStatus,
  normalizeSnapshotActivities,
  persistDiffPanelWidth,
  persistMessageProcessMap,
  persistSessionId,
  persistWorkspaceDir,
  pruneCanonicalizedLiveActivities,
  readPersistedDiffPanelWidth,
  readPersistedMessageProcessMap,
  readPersistedSessionId,
  readPersistedWorkspaceDir,
  resolveStatusSnapshotActivities,
  resolveDictationRuntime,
  resolvePathForIde,
  resolveToolCallSandboxProvider,
  summarizeMessageFileChanges,
  summarizeSessionFileChanges,
  toLiveActivityItems,
  tryParseJsonRecord,
  applyLiveActivityEvent,
  type ArtifactSummaryView,
  buildPreSteeringActivityMessage,
  type ChatMessage,
  type DictationMode,
  type DictationRuntimeCapabilities,
  type FileChangeItem,
  type FileChangeSummary,
  type PendingProcessCapture,
  type RevertTarget,
  type SessionStatusResponse,
  type SessionStatusSnapshot,
  type SpeechRecognitionLike,
  type SpeechRecognitionWindow,
  type ToolCall,
} from "./chat/chatModel";
import { LiveActivityTimeline, ProcessActivityList } from "./chat/ActivityTimeline";
import { DiffCodeBlock, MessageContent } from "./chat/MessageContent";
import { SessionsPanel } from "./chat/SessionSidebar";
import { isDesktopHostRuntime, openDesktopDirectoryDialog } from "@/lib/desktopHost";

type LiveStatusSnapshotLike = StatusSessionSnapshot | SessionStatusSnapshot;

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

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.max(0, Math.round(value)));
}

function contextUsageLabel(usage?: SessionContextUsage | null): string {
  if (!usage) return "Context usage unavailable until this session is loaded.";
  return `${formatTokenCount(usage.usedTokens)} of ${formatTokenCount(
    usage.limitTokens
  )} tokens used (${usage.usedPercent}%). ${formatTokenCount(
    usage.remainingTokens
  )} tokens remaining.`;
}

function providerPlanTooltipDetail(plan?: ProviderPlanSnapshot | null): string | null {
  const windowSummary = providerPlanWindowSummary(plan);
  return windowSummary ? `Plan usage: ${windowSummary}` : null;
}

function providerPlanTooltipRows(
  plan?: ProviderPlanSnapshot | null
): Array<{ label: string; usage: ProviderPlanWindowDisplay }> {
  if (!plan?.managedAutomatically) return [];
  return [
    { label: "5h", usage: providerPlanWindowDisplay(plan, "rolling_5h") },
    { label: "Weekly", usage: providerPlanWindowDisplay(plan, "rolling_week") },
  ].filter(({ usage }) => usage.unlimited || usage.percent !== null);
}

function contextUsageTooltip(
  usage?: SessionContextUsage | null,
  providerPlan?: ProviderPlanSnapshot | null
) {
  const planDetail = providerPlanTooltipDetail(providerPlan);
  const planRows = providerPlanTooltipRows(providerPlan);
  if (!usage) {
    return {
      percent: "?",
      title: "Context window:",
      body: "Not loaded yet",
      detail: "Open a session or send a message to estimate usage.",
      planDetail,
      planRows,
    };
  }
  const percent = Math.min(100, Math.max(0, usage.usedPercent));
  return {
    percent: `${Math.round(percent)}%`,
    title: "Context window:",
    body: `${Math.round(percent)}% full`,
    detail: `${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(
      usage.limitTokens
    )} tokens used`,
    planDetail,
    planRows,
  };
}

type ToolApprovalMode = "always_allow" | "ask";

function normalizeToolApprovalMode(value: unknown): ToolApprovalMode {
  return value === "ask" ? "ask" : "always_allow";
}

function toolApprovalModeLabel(mode: ToolApprovalMode): string {
  return mode === "ask" ? "Ask Me" : "Always Allow";
}

function ContextUsageRing({
  usage,
  providerPlan,
}: {
  usage?: SessionContextUsage | null;
  providerPlan?: ProviderPlanSnapshot | null;
}) {
  const [open, setOpen] = useState(false);
  const percent = usage ? Math.min(100, Math.max(0, usage.usedPercent)) : 0;
  const color =
    percent >= 90
      ? "var(--context-ring-danger)"
      : percent >= 70
        ? "var(--context-ring-warn)"
        : "var(--context-ring-ok)";
  const tooltip = contextUsageTooltip(usage, providerPlan);
  const label = contextUsageLabel(usage);
  return (
    <div
      aria-label={label}
      className="relative h-5 w-5 shrink-0 rounded-full outline-none"
      onBlur={() => setOpen(false)}
      onClick={() => setOpen((value) => !value)}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      tabIndex={0}
    >
      <div
        className="absolute inset-[3px] rounded-full p-[1.5px]"
        style={{
          background: `conic-gradient(${color} ${percent * 3.6}deg, var(--context-ring-track) 0deg)`,
        }}
      >
        <div className="context-usage-ring-fill h-full w-full rounded-full" />
      </div>
      <div
        role="tooltip"
        className={cn(
          "context-usage-tooltip pointer-events-none absolute bottom-full left-1/2 z-50 mb-3 w-max max-w-[280px] -translate-x-1/2 rounded-lg border px-3 py-2 text-center text-[12px] leading-5",
          open ? "block" : "hidden"
        )}
      >
        <div className="context-usage-tooltip-title">{tooltip.title}</div>
        <div className="context-usage-tooltip-body font-medium">{tooltip.body}</div>
        <div className="context-usage-tooltip-detail">{tooltip.detail}</div>
        {tooltip.planRows.length > 0 && (
          <div className="context-usage-tooltip-plan mt-2 space-y-1.5 border-t pt-2 text-left">
            <div className="text-[11px] font-medium">Plan usage</div>
            {tooltip.planRows.map(({ label, usage }) => (
              <ProviderPlanTooltipBar key={label} label={label} usage={usage} />
            ))}
            {tooltip.planDetail && <div className="sr-only">{tooltip.planDetail}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderPlanTooltipBar({
  label,
  usage,
}: {
  label: string;
  usage: ProviderPlanWindowDisplay;
}) {
  const classes = providerPlanUsageClasses(usage);
  const width = usage.unlimited ? 100 : (usage.percent ?? 0);
  return (
    <div className="context-usage-tooltip-plan-bar">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="text-gray-500">{label}</span>
        <span className={`font-semibold tabular-nums ${classes.textClass}`}>{usage.value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${classes.fillClass}`}
          style={{ width: `${Math.max(usage.unlimited ? 100 : 2, width)}%` }}
        />
      </div>
      {usage.resetLabel && (
        <div className="mt-0.5 truncate text-[10px] text-gray-500">{usage.resetLabel}</div>
      )}
    </div>
  );
}

function ChatApprovalControls({
  mode,
  onChange,
  updating,
}: {
  mode: ToolApprovalMode;
  onChange: (mode: ToolApprovalMode) => void;
  updating?: boolean;
}) {
  const isAskMode = mode === "ask";
  const Icon = updating ? Loader2 : isAskMode ? CircleHelp : ShieldAlert;
  return (
    <div className="relative min-w-0">
      <Icon
        className={cn(
          "pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2",
          updating ? "animate-spin text-gray-400" : isAskMode ? "text-sky-300" : "text-amber-300"
        )}
      />
      <label className="sr-only" htmlFor="chat-tool-approval-mode">
        Tool approval mode
      </label>
      <select
        id="chat-tool-approval-mode"
        value={mode}
        disabled={updating}
        onChange={(event) => onChange(normalizeToolApprovalMode(event.target.value))}
        title={`Tool approvals: ${toolApprovalModeLabel(mode)}`}
        className={cn(
          "h-7 max-w-[140px] appearance-none truncate rounded-full border border-transparent bg-transparent py-1 pl-7 pr-6 text-[11px] font-semibold outline-none transition-colors [color-scheme:dark] disabled:opacity-60",
          isAskMode
            ? "text-sky-300 hover:bg-sky-500/10 hover:text-sky-200 focus:bg-sky-500/10"
            : "text-amber-300 hover:bg-amber-500/10 hover:text-amber-200 focus:bg-amber-500/10"
        )}
      >
        <option value="always_allow" className="bg-[#11131c] text-white">
          Always Allow
        </option>
        <option value="ask" className="bg-[#11131c] text-white">
          Ask Me
        </option>
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2",
          isAskMode ? "text-sky-300/70" : "text-amber-300/70"
        )}
      />
    </div>
  );
}

function ChatAgentControls({
  agents,
  selectedAgentId,
  contextUsage,
  providerPlan,
  onSelectAgent,
  updating,
}: {
  agents: Agent[];
  selectedAgentId?: string;
  contextUsage?: SessionContextUsage | null;
  providerPlan?: ProviderPlanSnapshot | null;
  onSelectAgent: (agentId?: string) => void;
  updating?: boolean;
}) {
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const routeLabel = selectedAgent?.model || selectedAgent?.name || "Gateway default";
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <ContextUsageRing usage={contextUsage} providerPlan={providerPlan} />
      <label className="sr-only" htmlFor="chat-agent-selector">
        Chat agent
      </label>
      <div className="relative min-w-0">
        <select
          id="chat-agent-selector"
          value={selectedAgentId || ""}
          disabled={updating}
          onChange={(event) => onSelectAgent(event.target.value || undefined)}
          title={routeLabel}
          className="h-7 min-w-[104px] max-w-[196px] appearance-none truncate rounded-full border border-transparent bg-transparent py-1 pl-2 pr-6 text-[11px] font-medium text-gray-300 outline-none transition-colors [color-scheme:dark] hover:bg-white/[0.06] hover:text-white focus:border-white/15 focus:bg-white/[0.06] disabled:opacity-60"
        >
          <option value="" className="bg-[#11131c] text-white">
            Gateway default
          </option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id} className="bg-[#11131c] text-white">
              {agent.model ? `${agent.name} - ${agent.model}` : agent.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
      </div>
      {updating ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" /> : null}
    </div>
  );
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

function PendingChatQueue({
  messages,
  onSteer,
  onReorder,
  onUpdate,
  onDelete,
  steeringMessageId,
  mutatingMessageId,
}: {
  messages: PendingChatMessage[];
  onSteer: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpdate: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  steeringMessageId: string | null;
  mutatingMessageId: string | null;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  if (messages.length === 0) return null;

  const beginEdit = (message: PendingChatMessage) => {
    setEditingId(message.id);
    setEditingContent(message.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
  };

  const submitEdit = (message: PendingChatMessage) => {
    const nextContent = editingContent.trim();
    if (!nextContent || nextContent === message.content.trim()) {
      cancelEdit();
      return;
    }
    onUpdate(message.id, nextContent);
    cancelEdit();
  };

  const handleEditKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    message: PendingChatMessage
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitEdit(message);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };

  const reorderMessages = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = messages.findIndex((message) => message.id === sourceId);
    const targetIndex = messages.findIndex((message) => message.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...messages];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    onReorder(next.map((message) => message.id));
  };

  return (
    <div data-testid="pending-chat-queue" className="mb-2 w-full min-w-0 space-y-1.5">
      {messages.map((message) => {
        const isSteering = message.mode === "steering";
        const isOptimistic = message.id.startsWith("optimistic-");
        const isMutating = mutatingMessageId === message.id;
        const canChange = !isSteering && !isOptimistic && !isMutating;
        const canDrag = messages.length > 1 && canChange;
        const isEditing = editingId === message.id;
        return (
          <div
            key={message.id}
            data-testid="pending-chat-message"
            onMouseUp={() => {
              if (!draggingId) return;
              reorderMessages(draggingId, message.id);
              setDraggingId(null);
            }}
            className={cn(
              "flex h-11 w-full min-w-0 select-none items-center gap-2 rounded-t-2xl rounded-b-lg border border-white/10 bg-white/[0.055] px-3 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.22)]",
              canDrag ? "cursor-grab active:cursor-grabbing" : "",
              draggingId === message.id ? "opacity-60" : ""
            )}
          >
            {canDrag ? (
              <span
                className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-gray-500"
                title="Drag to reorder"
                aria-label="Drag to reorder queued message"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setDraggingId(message.id);
                }}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            ) : (
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            )}
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                isSteering ? "bg-emerald-500/15 text-emerald-200" : "bg-white/8 text-gray-300"
              )}
            >
              {isSteering ? "Steering" : "Queued"}
            </span>
            {isEditing ? (
              <input
                autoFocus
                value={editingContent}
                onChange={(event) => setEditingContent(event.target.value)}
                onBlur={() => submitEdit(message)}
                onKeyDown={(event) => handleEditKeyDown(event, message)}
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white outline-none focus:border-amber-400/40"
              />
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-gray-300"
                title={`${message.content} · ${formatRelativeTime(new Date(message.createdAt).toISOString())}`}
              >
                {message.content}
              </span>
            )}
            {!isSteering && (
              <>
                <button
                  type="button"
                  onClick={() => beginEdit(message)}
                  disabled={!canChange}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                  title="Edit queued message"
                  aria-label="Edit queued message"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(message.id)}
                  disabled={!canChange}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-40"
                  title="Delete queued message"
                  aria-label="Delete queued message"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {!isSteering ? (
              <button
                type="button"
                onClick={() => onSteer(message.id)}
                disabled={isOptimistic || steeringMessageId === message.id || isMutating}
                className="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-[12px] font-medium text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-60"
              >
                {isOptimistic
                  ? "Queueing..."
                  : steeringMessageId === message.id
                    ? "Steering..."
                    : "Steer"}
              </button>
            ) : (
              <span className="shrink-0 text-[11px] text-emerald-300">Steering</span>
            )}
          </div>
        );
      })}
    </div>
  );
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
    const task = newTask.trim();
    if (!task || spawnSubagent.isPending) return;
    try {
      await spawnSubagent.mutateAsync({
        task,
        label: `Task: ${task.slice(0, 30)}${task.length > 30 ? "..." : ""}`,
      });
      setNewTask("");
      setShowSpawnModal(false);
    } catch (error) {
      useUIStore
        .getState()
        .addToast("error", error instanceof Error ? error.message : "Failed to spawn subagent");
    }
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
            <label htmlFor="subagent-task-input" className="text-sm text-gray-400 mb-2 block">
              Task Description
            </label>
            <textarea
              id="subagent-task-input"
              data-autofocus
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleSpawn();
                }
              }}
              placeholder="Describe the task for the subagent..."
              className="w-full h-32 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 resize-none"
            />
            <p className="mt-1.5 text-[11px] text-gray-500">
              Press {navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"}+Enter to spawn
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setShowSpawnModal(false)}>
              Cancel
            </Button>
            <Button
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
            </Button>
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

  // Expanded state lives here (keyed by request id) so it survives the 3s poll
  // re-render / any row remount.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (approvals.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10">
      {approvals.map((req) => (
        <PendingApprovalRow
          key={req.id}
          req={req}
          onResolve={resolve}
          expanded={expandedIds.has(req.id)}
          onToggle={() => toggleExpanded(req.id)}
        />
      ))}
    </div>
  );
}

function PendingApprovalRow({
  req,
  onResolve,
  expanded,
  onToggle,
}: {
  req: { id: string; toolName: string; argsSummary: string };
  onResolve: (requestId: string, decision: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetail = req.argsSummary.trim().length > 0;

  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <button
          type="button"
          onClick={() => hasDetail && onToggle()}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
          title={hasDetail ? "Show details" : undefined}
        >
          <span className="font-medium text-amber-200 shrink-0">{req.toolName}</span>
          {hasDetail && (
            <>
              <span className="font-mono text-xs text-amber-200/60 truncate">
                {req.argsSummary}
              </span>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 text-amber-300/70 shrink-0 transition-transform",
                  expanded ? "rotate-180" : ""
                )}
              />
            </>
          )}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onResolve(req.id, "approve_once")}
            className="rounded px-2 py-0.5 text-xs font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors whitespace-nowrap"
          >
            Allow once
          </button>
          <button
            type="button"
            onClick={() => onResolve(req.id, "approve_session")}
            className="rounded px-2 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors whitespace-nowrap"
          >
            Allow session
          </button>
          <button
            type="button"
            onClick={() => onResolve(req.id, "deny")}
            className="rounded px-2 py-0.5 text-xs font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors whitespace-nowrap"
          >
            Deny
          </button>
        </div>
      </div>
      {expanded && hasDetail && (
        <pre className="mt-1.5 ml-6 max-h-48 overflow-auto rounded bg-black/30 p-2 text-xs font-mono text-amber-100/80 whitespace-pre-wrap break-all">
          {req.argsSummary}
        </pre>
      )}
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
  const updateSessionAgent = useUpdateSessionAgent();
  // Always-fresh callback so the SSE effect can refresh the open session's
  // persisted messages without re-subscribing on every render.
  const refreshSessionMessagesRef = useRef<(sid: string) => Promise<void>>(() => Promise.resolve());
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFileAttachment[]>([]);
  const [imageDragActive, setImageDragActive] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const copiedMessageTimerRef = useRef<number | null>(null);
  const handleCopyMessage = useCallback(async (index: number, content: string) => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
    } catch {
      // Clipboard API can be unavailable (permissions, embedded webviews);
      // fall back to the legacy selection-based copy.
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
  const [liveStatus, setLiveStatus] = useState<"thinking" | "generating" | "compacting" | "idle">(
    "idle"
  );
  const [liveActivities, setLiveActivities] = useState<LiveActivityItem[]>([]);
  const [liveCurrentStep, setLiveCurrentStep] = useState<string | null>(null);
  // Tracked (for cache/completion-handoff) but NOT rendered as a live answer:
  // during a run the UI shows only the working timeline/status, and the full
  // reply appears when the turn completes — consistent across all providers.
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<PendingChatMessage[]>([]);
  const [sessionContextUsage, setSessionContextUsage] = useState<SessionContextUsage | null>(null);
  const [steeringMessageId, setSteeringMessageId] = useState<string | null>(null);
  const [pendingMessageMutationId, setPendingMessageMutationId] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [dictationMode, setDictationMode] = useState<DictationMode>("auto");
  const [dictationLanguage, setDictationLanguage] = useState("en-US");
  const [dictationCapabilities, setDictationCapabilities] = useState<DictationRuntimeCapabilities>({
    nativeRecognition: false,
    mediaRecorder: false,
    microphone: false,
  });
  const [dictating, setDictating] = useState(false);
  const [dictationTranscribing, setDictationTranscribing] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<string | null>(null);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [toolApprovalMode, setToolApprovalMode] = useState<ToolApprovalMode>("always_allow");
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
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationChunksRef = useRef<Blob[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
  const pendingProcessCaptureRef = useRef<PendingProcessCapture | null>(null);
  const runActivityBufferRef = useRef<LiveActivityItem[]>([]);
  const liveActivitiesRef = useRef<LiveActivityItem[]>([]);
  const latestStatusTimestampBySessionRef = useRef<Record<string, number>>({});
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
  const dictationRuntime = useMemo(
    () => resolveDictationRuntime(dictationMode, dictationCapabilities),
    [dictationCapabilities, dictationMode]
  );
  const activeAgentForPlan = useMemo(
    () => agents.find((agent) => agent.id === (selectedAgentId || sessionAgentId || "")) ?? null,
    [agents, selectedAgentId, sessionAgentId]
  );
  const activeProviderPlan = useMemo(() => {
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
  }, [activeAgentForPlan, providerPlanStatus]);
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
    if (sessionId) {
      persistSessionId(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    const loadProviderPlans = async () => {
      const response = await providerPlansApi.status();
      if (!active) return;
      setProviderPlanStatus(response.success ? (response.data ?? null) : null);
    };
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
      const previousSelectedAgentId = selectedAgentId;
      const previousSessionAgentId = sessionAgentId;
      const nextAgentId = resolveSelectableSessionAgentId(agentId);
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
        return;
      }

      if (!sessionId) {
        setSessionAgentId(nextAgentId);
        setSessionContextUsage(null);
        return;
      }

      try {
        const updated = await updateSessionAgent.mutateAsync({
          sessionId,
          agentId: nextAgentId,
        });
        syncSessionAgentSelection(updated.agentId);
        setSessionContextUsage(updated.contextUsage ?? null);
      } catch (error) {
        setSelectedAgentId(previousSelectedAgentId);
        setSessionAgentId(previousSessionAgentId);
        console.error("Failed to update session agent:", error);
      }
    },
    [
      resolveSelectableSessionAgentId,
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
        mediaRecorder: false,
        microphone: false,
      });
      return;
    }
    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    setDictationCapabilities({
      nativeRecognition: !!SpeechCtor,
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

  // Stick to the bottom while a run streams (activities, tool calls, tokens),
  // but never yank the view if the user scrolled up to read — the floating
  // "scroll to latest" button covers that case.
  useEffect(() => {
    if (artifactViewerTarget) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - (container.scrollTop + container.clientHeight) < 96;
    if (!nearBottom) return;
    const rafId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [liveActivities, streamingContent, liveCurrentStep, artifactViewerTarget]);

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
      phase: "start" | "result" | "error" | "blocked",
      text: string,
      toolName?: string,
      eventTimestamp?: number,
      toolCallId?: string,
      sandboxProvider?: string
    ) => {
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
    []
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
          currentStep = "Context automatically compacted";
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
    [resolveSnapshotLiveState, snapshotLatestTimestamp]
  );

  const cacheAssistantToken = useCallback((payload: StatusStreamTokenEvent) => {
    const tokenSessionId =
      typeof payload.sessionId === "string" && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : null;
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    if (!tokenSessionId || !delta) return;
    const cached = readCachedLiveSessionState(tokenSessionId);
    writeCachedLiveSessionState(tokenSessionId, {
      status: "generating",
      activities: cached?.activities || [],
      currentStep: cached?.currentStep || "Generating response...",
      streamingContent: `${cached?.streamingContent || ""}${delta}`,
    });
  }, []);

  const cacheLiveStatusEvent = useCallback((payload: StatusStreamStatusEvent) => {
    const payloadSessionId =
      typeof payload.sessionId === "string" && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : null;
    if (!payloadSessionId) return;
    const status = typeof payload.status === "string" ? payload.status : "";
    if (!status) return;
    const statusDetail = typeof payload.detail === "string" ? payload.detail.trim() : "";
    const isSteeringHandoff =
      status === "idle" && statusDetail.toLowerCase() === "steering to follow-up...";
    if ((status === "idle" && !isSteeringHandoff) || status === "error") {
      clearCachedLiveSessionState(payloadSessionId);
      return;
    }

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
        if (status === "compacting" || isMeaningfulThoughtDetail(detail)) {
          const text =
            status === "compacting" && !isMeaningfulThoughtDetail(detail)
              ? "Context automatically compacted"
              : detail;
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
  }, []);

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
    [cacheLiveStatusSnapshot, resolveSnapshotLiveState, snapshotLatestTimestamp]
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
      persistSessionId(null);
      clearChat();
      if (options?.resetAgentSelection) {
        setSessionAgentId(null);
        setSelectedAgentId(undefined);
      }
    },
    [clearChat]
  );

  useEffect(() => {
    activeSessionRef.current = sessionId;
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
        const result = await loadSessionMutation.mutateAsync(sid);
        if (result?.messagesList && activeSessionRef.current === sid) {
          loadSession(
            sid,
            result.messagesList as ChatMessage[],
            (result as { workspace_dir?: string | null }).workspace_dir || null
          );
          setSessionContextUsage(
            (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null
          );
        }
      } catch {
        // Keep whatever is on screen; the next explicit load will recover.
      }
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
                  typeof candidate === "string" && candidate.trim().length > 0
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
          // Token streaming: accumulate assistant text deltas for live display.
          if (payload.type === "assistant_token") {
            const delta = typeof payload.delta === "string" ? payload.delta : "";
            if (delta) {
              cacheAssistantToken(payload);
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
        const statusDetail = typeof payload.detail === "string" ? payload.detail.trim() : "";
        const isSteeringHandoff =
          status === "idle" && statusDetail.toLowerCase() === "steering to follow-up...";
        cacheLiveStatusEvent(payload);
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
            status === "compacting" ||
            status === "tool_executing" ||
            status === "tool_completed"
          ) {
            setActiveSessionIds((previous) =>
              previous.includes(payloadSessionId) ? previous : [...previous, payloadSessionId]
            );
          }
          if ((status === "idle" && !isSteeringHandoff) || status === "error") {
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
        if (status === "compacting") {
          if (!payload.toolName) {
            const activeToolStep = getLatestInFlightStep(runActivityBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            const eventTimestamp =
              typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
                ? payload.timestamp
                : undefined;
            const compactingDetail = isMeaningfulThoughtDetail(detail)
              ? detail
              : "Context automatically compacted";
            appendLiveActivity("result", compactingDetail, "__thought", eventTimestamp);
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
              // A run this client didn't drive just finished (started on
              // another client, or we remounted mid-run). Fetch the persisted
              // reply BEFORE dropping the live timeline/stream so the chat
              // never goes blank at completion.
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
    const requestedQueueMode =
      canQueueCurrentMessage() || pendingMessages.length > 0 ? "queue" : undefined;
    const requestSessionId = requestedQueueMode
      ? sessionId || activeSessionRef.current
      : sessionId || activeSessionRef.current || crypto.randomUUID();
    const queueMode = requestedQueueMode && requestSessionId ? "queue" : undefined;
    const hasAttachments = pendingImages.length > 0 || pendingFiles.length > 0;
    if ((!input.trim() && !hasAttachments) || (isLoading && !queueMode)) return;
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
      clearCachedLiveSessionState(sessionId);
    }
    setLiveStatus("idle");
    setLiveCurrentStep(null);
    setLiveActivities([]);
    setLoadingSessionId(null);
    runActivityBufferRef.current = [];
    pendingProcessCaptureRef.current = null;
  }, [selectedAgentId, sessionAgentId, stopGenerating, stopAgent, sessionId]);

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
    dictationLanguage,
    dictationRuntime.engine,
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
        if (restoreSessionGenerationRef.current !== restoreGeneration || activeSessionRef.current) {
          return null;
        }
        const payload = response.data as SessionStatusResponse;
        const activeSnapshots = Array.isArray(payload.activeSessions) ? payload.activeSessions : [];
        const activeIds = Array.isArray(payload.activeSessionIds) ? payload.activeSessionIds : [];
        setActiveSessionIds(activeIds.filter(isRestorableChatSessionId));
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
      if (sessionParam) {
        await restoreSessionFromId(sessionParam, { replaceRoute: true });
        return;
      }
      if (suppressAutoRestoreRef.current) return;
      if (sessionId) return;
      const freshestActiveSessionId = await resolveFreshestActiveSessionId();
      const targetSessionId = freshestActiveSessionId || persistedSessionId;
      if (!targetSessionId) return;
      persistSessionId(targetSessionId);
      const restored = await restoreSessionFromId(targetSessionId);
      if (!restored && !freshestActiveSessionId && readPersistedSessionId() === targetSessionId) {
        persistSessionId(null);
      }
      if (!restored && freshestActiveSessionId && persistedSessionId) {
        await restoreSessionFromId(persistedSessionId);
      }
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
  const sendQueuesFollowUp = showWorkingTimeline || pendingMessages.length > 0;
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
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => void handleSelectWorkspace()}
            disabled={workspaceSaving}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 text-[11px] text-blue-300 hover:text-blue-200 hover:bg-blue-500/15 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            title={
              effectiveWorkspaceDir
                ? `Workspace: ${effectiveWorkspaceDir} — click to change`
                : "Select workspace folder for this session"
            }
          >
            {workspaceSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5" />
            )}
            <span className="hidden md:inline font-mono">
              {effectiveWorkspaceDir
                ? formatWorkspaceLabel(effectiveWorkspaceDir, 36)
                : "Select Workspace"}
            </span>
          </button>
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
            onLoadSession={(id, msgs, loadedWorkspaceDir, loadedAgentId, loadedContextUsage) => {
              suppressAutoRestoreRef.current = false;
              activeSessionRef.current = id;
              loadSession(id, msgs, loadedWorkspaceDir);
              syncSessionAgentSelection(loadedAgentId);
              setSessionContextUsage(loadedContextUsage ?? null);
            }}
            onNewSession={() => {
              resetChatSession({ resetAgentSelection: true });
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
                                    <a
                                      key={`msg-image-${originalIndex}-${imageIndex}`}
                                      href={src}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block max-w-[220px] overflow-hidden rounded-lg border border-white/12"
                                    >
                                      <img
                                        src={src}
                                        alt="Attachment"
                                        loading="lazy"
                                        className="h-auto max-h-64 w-full object-contain"
                                      />
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                            <MessageContent content={message.content} />
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
                    "rounded-[22px] border bg-white/[0.035] px-3 py-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] transition-colors",
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
                  {pendingImages.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-2">
                      {pendingImages.map((image, index) => (
                        <div
                          key={`pending-image-${index}`}
                          className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/12"
                        >
                          <img
                            src={chatImageSrc(image)}
                            alt="Attachment preview"
                            className="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removePendingImage(index)}
                            className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                            aria-label="Remove attachment"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {pendingFiles.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-2">
                      {pendingFiles.map((file, index) => (
                        <div
                          key={`pending-file-${index}`}
                          className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-2 py-1 text-xs text-gray-200"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className="max-w-[160px] truncate">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => removePendingFile(index)}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:bg-white/10 hover:text-white"
                            aria-label="Remove file"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
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
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handleComposerPaste}
                    placeholder="Type a message..."
                    rows={1}
                    className="w-full min-h-[38px] max-h-[220px] overflow-y-auto resize-none bg-transparent px-0 py-1 text-[13px] leading-5 text-white placeholder-gray-500 !outline-none"
                  />
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
                      contextUsage={sessionContextUsage}
                      providerPlan={activeProviderPlan}
                      onSelectAgent={(agentId) => void handleSelectAgent(agentId)}
                      updating={updateSessionAgent.isPending}
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-gray-400 transition-colors cursor-pointer hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-gray-400 transition-colors cursor-pointer hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
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
                    {showWorkingTimeline && (
                      <button
                        type="button"
                        onClick={() => void handleStopActive()}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/35 bg-red-500/15 text-red-300 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        disabled={stopAgent.isPending}
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
                      onClick={handleSend}
                      disabled={
                        (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0) ||
                        (isLoading && !sendQueuesFollowUp)
                      }
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full accent-button disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      title={sendQueuesFollowUp ? "Queue follow-up" : "Send message"}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
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
                  activeSessionRef.current = sessionKey;
                  loadSession(
                    sessionKey,
                    result.messagesList as ChatMessage[],
                    (result as { workspace_dir?: string | null }).workspace_dir || null
                  );
                  syncSessionAgentSelection(
                    (result as { agent_id?: string | null }).agent_id || null
                  );
                  setSessionContextUsage(
                    (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null
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
