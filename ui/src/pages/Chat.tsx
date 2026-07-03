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
import { isDesktopHostRuntime, openDesktopDirectoryDialog } from "@/lib/desktopHost";

interface ToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  result?: unknown;
  duration?: number;
  timeline_index?: number;
  started_at?: number;
  status: "pending" | "executing" | "completed" | "failed" | "success" | "error";
}

interface ArtifactSummaryView {
  sessionId: string;
  name: string;
  fileName: string;
  title: string;
  path?: string;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  tool_calls?: ToolCall[];
  process_activities?: Array<{
    id?: string;
    phase?: "start" | "result" | "error";
    text?: string;
    timestamp?: number | string;
    toolName?: string;
    toolCallId?: string;
  }>;
  thinking?: string;
  _truncated?: string;
  _tool_calls_hidden_count?: number;
  _tool_calls_total_count?: number;
  subagent_calls?: {
    id: string;
    task: string;
    status: string;
  }[];
}

interface FileChangeItem {
  path: string;
  type: "created" | "updated" | "deleted";
  added: number;
  removed: number;
  diff?: string;
}

interface FileChangeSummary {
  files: FileChangeItem[];
  totalAdded: number;
  totalRemoved: number;
}

interface RevertTarget {
  index: number;
  content: string;
  timestamp?: string;
}

interface StatusStreamEvent {
  status?: string;
  timestamp?: number;
  detail?: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
  toolPhase?: "start" | "result" | "error";
  durationMs?: number;
  type?: string;
}

interface SessionStatusActivity {
  id: string;
  phase: "start" | "result" | "error";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

interface SessionStatusSnapshot {
  sessionId: string;
  status: string;
  timestamp: number;
  detail?: string;
  agentId?: string;
  activities: SessionStatusActivity[];
}

interface SessionStatusResponse {
  activeSessions?: SessionStatusSnapshot[];
  activeSessionIds: string[];
  count?: number;
  session?: SessionStatusSnapshot | null;
  active?: boolean;
  sessionId?: string;
}

interface SpeechRecognitionResultLike {
  transcript?: string;
}

interface SpeechRecognitionAlternativeLike {
  0?: SpeechRecognitionResultLike;
  isFinal?: boolean;
}

interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results?: ArrayLike<SpeechRecognitionAlternativeLike>;
}

interface SpeechRecognitionErrorLike {
  error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

interface PendingProcessCapture {
  assistantCountBefore: number;
  activities: LiveActivityItem[];
  sessionId: string | null;
  agentId?: string;
  createdAt: number;
}

const LAST_WORKSPACE_STORAGE_KEY = "cybara:lastWorkspaceDir";
const LAST_SESSION_STORAGE_KEY = "cybara:lastSessionId";
const MESSAGE_PROCESS_MAP_STORAGE_KEY = "cybara:messageProcessMap";
const DIFF_PANEL_WIDTH_STORAGE_KEY = "cybara:chatDiffPanelWidth";
const SESSION_ACTIVITY_STALE_MS = 30_000;
const PENDING_CAPTURE_TIMEOUT_MS = 90_000;
const DIFF_PANEL_DEFAULT_WIDTH = 560;
const DIFF_PANEL_MIN_WIDTH = 380;
const DIFF_PANEL_MAX_WIDTH = 1120;

function getMessageProcessKey(
  sessionKey: string | null,
  message: ChatMessage,
  fallbackIndex: number
): string {
  const hashSource = `${message.role}:${message.content || ""}`.slice(0, 1200);
  let hash = 2166136261;
  for (let index = 0; index < hashSource.length; index += 1) {
    hash ^= hashSource.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const fingerprint = (hash >>> 0).toString(36);
  return `${sessionKey || "default"}:${fallbackIndex}:${fingerprint}`;
}

function getLegacyMessageProcessKey(
  sessionKey: string | null,
  message: ChatMessage,
  fallbackIndex: number
): string {
  return `${sessionKey || "default"}:${message.timestamp || fallbackIndex}`;
}

function getMessageProcessActivities(
  map: Record<string, LiveActivityItem[]>,
  sessionKey: string | null,
  message: ChatMessage,
  fallbackIndex: number
): LiveActivityItem[] {
  const canonicalKey = getMessageProcessKey(sessionKey, message, fallbackIndex);
  const canonical = map[canonicalKey];
  if (Array.isArray(canonical) && canonical.length > 0) {
    return canonical;
  }
  const legacyKey = getLegacyMessageProcessKey(sessionKey, message, fallbackIndex);
  const legacy = map[legacyKey];
  if (Array.isArray(legacy) && legacy.length > 0) {
    return legacy;
  }
  return [];
}

function readStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function readPersistedWorkspaceDir(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function persistWorkspaceDir(workspaceDir: string | null): void {
  if (typeof window === "undefined" || !workspaceDir) return;
  try {
    const trimmed = workspaceDir.trim();
    if (!trimmed) return;
    window.localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, trimmed);
  } catch {
    // Ignore local storage errors
  }
}

function readPersistedSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function clampDiffPanelWidth(value: number): number {
  return Math.max(DIFF_PANEL_MIN_WIDTH, Math.min(DIFF_PANEL_MAX_WIDTH, value));
}

function readPersistedDiffPanelWidth(): number {
  if (typeof window === "undefined") return DIFF_PANEL_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(DIFF_PANEL_WIDTH_STORAGE_KEY);
    if (!raw) return DIFF_PANEL_DEFAULT_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DIFF_PANEL_DEFAULT_WIDTH;
    return clampDiffPanelWidth(Math.floor(parsed));
  } catch {
    return DIFF_PANEL_DEFAULT_WIDTH;
  }
}

function persistDiffPanelWidth(width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DIFF_PANEL_WIDTH_STORAGE_KEY, String(clampDiffPanelWidth(width)));
  } catch {
    // Ignore local storage errors
  }
}

function persistSessionId(sessionId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!trimmed) {
      window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, trimmed);
  } catch {
    // Ignore local storage errors
  }
}

function normalizePersistedLiveActivityItem(value: unknown): LiveActivityItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  const timestamp =
    typeof candidate.timestamp === "number" && Number.isFinite(candidate.timestamp)
      ? candidate.timestamp
      : Date.now();
  const phase =
    candidate.phase === "start" || candidate.phase === "result" || candidate.phase === "error"
      ? candidate.phase
      : "result";
  if (!id || !text) return null;
  return {
    id,
    text,
    timestamp,
    phase,
    toolName: typeof candidate.toolName === "string" ? candidate.toolName : undefined,
    toolCallId: typeof candidate.toolCallId === "string" ? candidate.toolCallId : undefined,
    sandboxProvider: normalizeSandboxProviderValue(candidate.sandboxProvider),
  };
}

function normalizeMessageProcessActivities(
  value: unknown,
  fallbackBaseTimestamp?: number
): LiveActivityItem[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const fallbackTimestamp =
    typeof fallbackBaseTimestamp === "number" && Number.isFinite(fallbackBaseTimestamp)
      ? fallbackBaseTimestamp
      : Date.now();
  const normalized: LiveActivityItem[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = normalizePersistedLiveActivityItem(value[index]);
    if (!candidate) continue;
    if (!Number.isFinite(candidate.timestamp)) {
      candidate.timestamp = fallbackTimestamp + index;
    }
    normalized.push(candidate);
  }
  return normalized;
}

function readPersistedMessageProcessMap(): Record<string, LiveActivityItem[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MESSAGE_PROCESS_MAP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, LiveActivityItem[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== "string" || !Array.isArray(value)) continue;
      const normalized = value
        .map((entry) => normalizePersistedLiveActivityItem(entry))
        .filter((entry): entry is LiveActivityItem => !!entry);
      if (normalized.length === 0) continue;
      next[key] = normalized;
    }
    return next;
  } catch {
    return {};
  }
}

function persistMessageProcessMap(map: Record<string, LiveActivityItem[]>): void {
  if (typeof window === "undefined") return;
  try {
    const serializable: Record<string, LiveActivityItem[]> = {};
    for (const [key, value] of Object.entries(map)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      serializable[key] = value;
    }
    window.localStorage.setItem(MESSAGE_PROCESS_MAP_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Ignore local storage errors
  }
}

function readNumberArg(args: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function formatWorkspaceLabel(path: string, maxLength = 44): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const tail = segments.length > 0 ? segments[segments.length - 1] : normalized;
  if (normalized.length <= maxLength) return normalized;
  if (tail.length + 4 >= maxLength) return `.../${tail.slice(-(maxLength - 4))}`;
  const prefixLength = Math.max(0, maxLength - tail.length - 4);
  return `${normalized.slice(0, prefixLength)}.../${tail}`;
}

function displayProviderLabel(value?: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .trim()
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function sessionRouteLabel(session: Record<string, unknown>): string | null {
  const providerName =
    typeof session.provider_name === "string" && session.provider_name.trim()
      ? session.provider_name.trim()
      : displayProviderLabel(typeof session.provider === "string" ? session.provider : null);
  const model =
    typeof session.model === "string" && session.model.trim() ? session.model.trim() : null;
  const agentName =
    typeof session.agent_name === "string" && session.agent_name.trim()
      ? session.agent_name.trim()
      : null;
  const agentId =
    typeof session.agent_id === "string" && session.agent_id.trim()
      ? session.agent_id.trim()
      : null;

  if (providerName && model && agentName) return `${providerName} · ${model} · ${agentName}`;
  if (providerName && model) return `${providerName} · ${model}`;
  if (model && agentName) return `${model} · ${agentName}`;
  if (model) return model;
  return agentName || (agentId && agentId !== "default" ? `Agent ${agentId}` : null);
}

function sessionDisplayTitle(session: Record<string, unknown>): string {
  const id = typeof session.id === "string" ? session.id : "";
  const rawTitle =
    typeof session.title === "string" && session.title.trim()
      ? session.title.trim()
      : `Session ${id.slice(0, 8)}...`;
  const agentName =
    typeof session.agent_name === "string" && session.agent_name.trim()
      ? session.agent_name.trim()
      : null;
  if (agentName && rawTitle.toLowerCase().startsWith(`${agentName.toLowerCase()}:`)) {
    const stripped = rawTitle.slice(agentName.length + 1).trim();
    if (stripped) return stripped;
  }
  return rawTitle;
}

const SESSION_PREVIEW_LIMIT = 160;

function sessionPreviewText(content: unknown, limit = SESSION_PREVIEW_LIMIT): string | null {
  if (typeof content !== "string") return null;
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function toActivityPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function isGenericStatusLabel(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "thinking..." ||
    normalized === "thinking" ||
    normalized === "generating response..." ||
    normalized === "generating response" ||
    normalized === "idle" ||
    normalized === "working..." ||
    normalized === "working"
  );
}

function isMeaningfulThoughtDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) return false;
  return !isGenericStatusLabel(normalized);
}

function getLatestInFlightStep(activities: LiveActivityItem[]): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.phase !== "start") continue;
    const step = activity.text?.trim() || "";
    if (!step || isGenericStatusLabel(step)) continue;
    return step;
  }
  return null;
}

function normalizeSnapshotActivities(
  activities: LiveActivityItem[],
  status: string
): LiveActivityItem[] {
  if (activities.length === 0) return [];

  const sorted = [...activities].sort((a, b) => a.timestamp - b.timestamp);
  const keepLatestStartInFlight = status === "tool_executing";
  let latestStartIndex = -1;

  if (keepLatestStartInFlight) {
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (sorted[index]?.phase === "start") {
        latestStartIndex = index;
        break;
      }
    }
  }

  const normalized = sorted.map((activity, index) => {
    if (activity.phase !== "start") return activity;
    if (keepLatestStartInFlight && index === latestStartIndex) {
      return activity;
    }
    return {
      ...activity,
      phase: "result" as const,
      text: normalizeActivityTextForPhase(activity.text, "result"),
    };
  });

  return mergeActivityLists([], normalized);
}

function summarizeCommand(command: string): string {
  const compact = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (!compact) return "command";
  if (compact.length > 72) return `${compact.slice(0, 69)}...`;
  return compact;
}

function formatToolIntent(
  toolName: string,
  args: Record<string, unknown>,
  phase: "start" | "result" | "error",
  fallbackDetail?: string
): string {
  if (fallbackDetail && fallbackDetail.trim()) {
    const normalizedFallback = fallbackDetail.trim();
    if (!isGenericStatusLabel(normalizedFallback)) {
      return normalizeActivityTextForPhase(normalizedFallback, phase);
    }
  }

  const key = toolName.toLowerCase();
  const path = readStringArg(args, ["path", "file_path", "filePath"]);
  const displayPath = path ? toActivityPath(path) : undefined;

  if (key === "read") {
    if (path) {
      const offset = readNumberArg(args, ["offset"]);
      const limit = readNumberArg(args, ["limit"]);
      if (offset !== undefined && limit !== undefined && limit > 0) {
        const startLine = Math.max(1, Math.floor(offset));
        const endLine = startLine + Math.max(1, Math.floor(limit)) - 1;
        if (phase === "start") return `Exploring ${displayPath} (lines ${startLine}-${endLine})`;
        if (phase === "result") return `Explored ${displayPath} (lines ${startLine}-${endLine})`;
        return `Read failed for ${displayPath}`;
      }
      if (phase === "start") return `Exploring ${displayPath}`;
      if (phase === "result") return `Explored ${displayPath}`;
      return `Read failed for ${displayPath}`;
    }
    if (phase === "start") return "Exploring files...";
    if (phase === "result") return "Exploration complete";
    return "Read failed";
  }

  if (key === "write" || key === "edit") {
    if (path) {
      if (phase === "start")
        return key === "edit" ? `Editing ${displayPath}` : `Writing ${displayPath}`;
      if (phase === "result") return `Edited ${displayPath}`;
      return `Edit failed for ${displayPath}`;
    }
    if (phase === "start") return key === "edit" ? "Editing file..." : "Writing file...";
    if (phase === "result") return "Edit complete";
    return "Edit failed";
  }

  if (key === "file_search" || key === "grep") {
    const pattern = readStringArg(args, ["pattern", "query"]);
    const basePath = readStringArg(args, ["path"]);
    if (pattern && basePath) {
      if (phase === "start") return `Searching ${basePath} for "${pattern}"`;
      if (phase === "result") return `Searched ${basePath} for "${pattern}"`;
      return `Search failed in ${basePath}`;
    }
    if (pattern) {
      if (phase === "start") return `Searching for "${pattern}"`;
      if (phase === "result") return `Search complete for "${pattern}"`;
      return `Search failed for "${pattern}"`;
    }
    if (phase === "start") return "Searching files...";
    if (phase === "result") return "Search complete";
    return "Search failed";
  }

  if (key === "web_search") {
    const query = readStringArg(args, ["query"]);
    if (query) {
      if (phase === "start") return `Searching web for "${query}"`;
      if (phase === "result") return `Web search complete for "${query}"`;
      return `Web search failed for "${query}"`;
    }
    if (phase === "start") return "Searching the web...";
    if (phase === "result") return "Web search complete";
    return "Web search failed";
  }

  if (key === "web_fetch") {
    const url = readStringArg(args, ["url"]);
    if (url) {
      if (phase === "start") return `Fetching ${url}`;
      if (phase === "result") return `Fetched ${url}`;
      return `Fetch failed for ${url}`;
    }
    if (phase === "start") return "Fetching webpage...";
    if (phase === "result") return "Fetch complete";
    return "Fetch failed";
  }

  if (key === "exec" || key === "process" || key === "git") {
    const command = readStringArg(args, ["command", "cmd"]);
    if (command) {
      const summary = summarizeCommand(command);
      if (phase === "start") return `Running ${summary}`;
      if (phase === "result") return `Ran ${summary}`;
      return `Command failed: ${summary}`;
    }
    if (phase === "start") return "Running command...";
    if (phase === "result") return "Command complete";
    return "Command failed";
  }

  if (key === "browser") {
    const action = readStringArg(args, ["action"]);
    if (action) {
      if (phase === "start") return `Browser: ${action}`;
      if (phase === "result") return `Browser ${action} complete`;
      return `Browser ${action} failed`;
    }
    if (phase === "start") return "Browser action...";
    if (phase === "result") return "Browser action complete";
    return "Browser action failed";
  }

  if (key === "artifacts" || key === "artifact") {
    const action = (readStringArg(args, ["action"]) || "list").toLowerCase();
    const artifactNameRaw =
      readStringArg(args, ["name", "artifact", "artifactName", "fileName"]) ||
      readStringArg(args, ["kind", "type"]) ||
      "artifact";
    const artifactName = artifactNameRaw.endsWith(".md.resolved")
      ? artifactNameRaw
      : `${artifactNameRaw}.md.resolved`;

    if (action === "list") {
      if (phase === "start") return "Listing session artifacts...";
      if (phase === "result") return "Listed session artifacts";
      return "Artifact listing failed";
    }
    if (action === "create") {
      if (phase === "start") return `Creating ${artifactName}`;
      if (phase === "result") return `Created ${artifactName}`;
      return `Artifact create failed for ${artifactName}`;
    }
    if (action === "read") {
      if (phase === "start") return `Reading ${artifactName}`;
      if (phase === "result") return `Read ${artifactName}`;
      return `Artifact read failed for ${artifactName}`;
    }
    if (action === "delete") {
      if (phase === "start") return `Deleting ${artifactName}`;
      if (phase === "result") return `Deleted ${artifactName}`;
      return `Artifact delete failed for ${artifactName}`;
    }
    if (phase === "start") return `Updating ${artifactName}`;
    if (phase === "result") return `Updated ${artifactName}`;
    return `Artifact update failed for ${artifactName}`;
  }

  if (key === "todo") {
    const totalItems = Array.isArray(args.items) ? args.items.length : undefined;
    if (phase === "start")
      return totalItems
        ? `Planning ${totalItems} task${totalItems === 1 ? "" : "s"}...`
        : "Updating task list...";
    if (phase === "result")
      return totalItems
        ? `Planned ${totalItems} task${totalItems === 1 ? "" : "s"}`
        : "Updated task list";
    return "Task list update failed";
  }

  if (key === "clarify") {
    if (phase === "start") return "Asking a clarifying question...";
    if (phase === "result") return "Asked a clarifying question";
    return "Clarify failed";
  }

  if (phase === "start") return `${toolName} running...`;
  if (phase === "result") return `${toolName} complete`;
  return `${toolName} failed`;
}

function normalizeSessionStatus(status: string): "thinking" | "generating" | "idle" {
  if (status === "generating") return "generating";
  if (
    status === "thinking" ||
    status === "tool_executing" ||
    status === "tool_completed" ||
    status === "error"
  ) {
    return "thinking";
  }
  return "idle";
}

function toLiveActivityItems(activities: SessionStatusActivity[] | undefined): LiveActivityItem[] {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  return activities
    .filter(
      (activity) =>
        !!activity &&
        typeof activity.id === "string" &&
        typeof activity.text === "string" &&
        typeof activity.timestamp === "number"
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((activity) => ({
      id: activity.id,
      phase: activity.phase,
      text: activity.text,
      timestamp: activity.timestamp,
      toolName: activity.toolName,
      toolCallId: activity.toolCallId,
      sandboxProvider: normalizeSandboxProviderValue(activity.sandboxProvider),
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeArtifactFileName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.endsWith(".md.resolved")) return trimmed;
  return `${trimmed.replace(/\.md\.resolved$/i, "")}.md.resolved`;
}

function tryParseJsonRecord(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeSandboxProviderValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "apple_sandbox" ||
    normalized === "podman" ||
    normalized === "docker" ||
    normalized === "host"
  ) {
    return normalized;
  }
  return undefined;
}

function formatSandboxProviderLabel(provider: string): string {
  if (provider === "apple_sandbox") return "Apple Sandbox";
  if (provider === "podman") return "Podman";
  if (provider === "docker") return "Docker";
  if (provider === "host") return "Host";
  return provider;
}

function resolveToolCallSandboxProvider(toolCall: ToolCall): string | undefined {
  const parsedResult = tryParseJsonRecord(toolCall.result);
  if (!isRecord(parsedResult)) return undefined;
  return normalizeSandboxProviderValue(
    parsedResult.sandboxProvider ?? parsedResult.sandbox_provider
  );
}

function parseArtifactSummary(value: unknown): ArtifactSummaryView | null {
  const parsedValue = tryParseJsonRecord(value);
  if (!isRecord(parsedValue)) return null;
  const sessionId = typeof parsedValue.sessionId === "string" ? parsedValue.sessionId.trim() : "";
  const name = typeof parsedValue.name === "string" ? parsedValue.name.trim() : "";
  const fileNameRaw = typeof parsedValue.fileName === "string" ? parsedValue.fileName.trim() : "";
  const fileName = normalizeArtifactFileName(fileNameRaw || name);
  const title = typeof parsedValue.title === "string" ? parsedValue.title.trim() : "";
  const path =
    typeof parsedValue.path === "string" && parsedValue.path.trim()
      ? parsedValue.path.trim()
      : undefined;
  if (!sessionId || !name || !fileName) return null;
  return {
    sessionId,
    name,
    fileName,
    title: title || fileName,
    path,
  };
}

function parseArtifactSummaries(value: unknown): ArtifactSummaryView[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => parseArtifactSummary(entry))
    .filter((entry): entry is ArtifactSummaryView => entry !== null);
}

function dedupeArtifactSummaries(summaries: ArtifactSummaryView[]): ArtifactSummaryView[] {
  const seen = new Set<string>();
  const deduped: ArtifactSummaryView[] = [];
  for (const summary of summaries) {
    const key = `${summary.sessionId}:${summary.fileName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(summary);
  }
  return deduped;
}

function inferArtifactSummaries(tool: ToolCall, sessionId?: string | null): ArtifactSummaryView[] {
  const parsedResult = tryParseJsonRecord(tool.result);
  const result = isRecord(parsedResult) ? parsedResult : null;
  const summaries: ArtifactSummaryView[] = [];
  const fromResult = parseArtifactSummary(result?.artifact);
  if (fromResult) {
    summaries.push(fromResult);
  }
  summaries.push(...parseArtifactSummaries(result?.artifacts));
  summaries.push(...parseArtifactSummaries(result?.availableArtifacts));

  if (summaries.length === 0 && (tool.name === "artifacts" || tool.name === "artifact")) {
    const args = tool.arguments || tool.args || {};
    const nameCandidate =
      readStringArg(args, ["name", "artifact", "artifactName", "fileName"]) ||
      readStringArg(args, ["kind", "type"]);
    const sessionCandidate =
      (result && typeof result.sessionId === "string" ? result.sessionId : undefined) ||
      readStringArg(args, ["sessionId"]) ||
      (typeof sessionId === "string" ? sessionId : undefined);

    if (nameCandidate && sessionCandidate) {
      const fileName = normalizeArtifactFileName(nameCandidate);
      const name = fileName.replace(/\.md\.resolved$/i, "");
      summaries.push({
        sessionId: sessionCandidate,
        name,
        fileName,
        title: fileName,
        path: `~/.cybara/artifacts/${sessionCandidate}/${fileName}`,
      });
    }
  }

  return dedupeArtifactSummaries(summaries);
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function truncateDiff(diff: string, maxLines = 220): string {
  const lines = diff.split(/\r?\n/);
  if (lines.length <= maxLines) return diff;
  const omitted = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `... [diff truncated, ${omitted} lines omitted]`].join("\n");
}

function normalizeChangeType(raw: unknown): FileChangeItem["type"] {
  const type = typeof raw === "string" ? raw.toLowerCase() : "";
  if (type === "created" || type === "create" || type === "new") return "created";
  if (type === "deleted" || type === "delete" || type === "remove") return "deleted";
  return "updated";
}

function toFiniteNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function buildSimpleDiff(path: string, before: string, after: string): string {
  const beforeLines = before ? before.split(/\r?\n/) : [];
  const afterLines = after ? after.split(/\r?\n/) : [];
  const header = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];
  const removed = beforeLines.map((line) => `-${line}`);
  const added = afterLines.map((line) => `+${line}`);
  return truncateDiff([...header, ...removed, ...added].join("\n"));
}

function extractFirstTargetLine(diff?: string): number | undefined {
  if (!diff) return undefined;
  const lines = diff.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^@@\s-\d+(?:,\d+)?\s\+(\d+)(?:,\d+)?\s@@/);
    if (!match?.[1]) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function resolvePathForIde(path: string, workspaceDir: string | null): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;

  const isAbsoluteUnix = trimmed.startsWith("/");
  const isAbsoluteHome = trimmed.startsWith("~");
  const isAbsoluteWindows = /^[A-Za-z]:[\\/]/.test(trimmed);
  if (isAbsoluteUnix || isAbsoluteHome || isAbsoluteWindows) {
    return trimmed;
  }

  if (!workspaceDir) return trimmed;
  const base = workspaceDir.replace(/[\\/]+$/, "");
  const relative = trimmed.replace(/^[./\\]+/, "");
  return `${base}/${relative}`;
}

function parsePatchFileChanges(patch: string): FileChangeItem[] {
  const changes: FileChangeItem[] = [];
  const lines = patch.split(/\r?\n/);
  let current: FileChangeItem | null = null;
  let diffLines: string[] = [];

  const pushCurrent = () => {
    if (!current) return;
    current.diff = truncateDiff(diffLines.join("\n"));
    changes.push(current);
    current = null;
    diffLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("--- ")) {
      pushCurrent();

      const oldPathRaw = line.slice(4).trim();
      const next = lines[index + 1] || "";
      const newPathRaw = next.startsWith("+++ ") ? next.slice(4).trim() : oldPathRaw;
      const oldPath = oldPathRaw.replace(/^[ab]\//, "");
      const newPath = newPathRaw.replace(/^[ab]\//, "");
      const type: FileChangeItem["type"] =
        oldPathRaw === "/dev/null" ? "created" : newPathRaw === "/dev/null" ? "deleted" : "updated";
      const path = type === "deleted" ? oldPath : newPath;
      current = {
        path,
        type,
        added: 0,
        removed: 0,
      };
      diffLines.push(line);
      if (next.startsWith("+++ ")) {
        diffLines.push(next);
        index += 1;
      }
      continue;
    }

    if (!current) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added += 1;
      diffLines.push(line);
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed += 1;
      diffLines.push(line);
      continue;
    }
    if (line.startsWith("@@") || line.startsWith("diff --git ") || line.startsWith(" ")) {
      diffLines.push(line);
    }
  }

  pushCurrent();
  return changes.filter((change) => !!change.path);
}

function parseChangeRecord(value: unknown): FileChangeItem | null {
  if (!isRecord(value)) return null;
  const path = typeof value.path === "string" ? value.path.trim() : "";
  if (!path) return null;
  const added =
    toFiniteNumber(value.added) ||
    toFiniteNumber(value.addedLines) ||
    toFiniteNumber(value.plus) ||
    0;
  const removed =
    toFiniteNumber(value.removed) ||
    toFiniteNumber(value.removedLines) ||
    toFiniteNumber(value.minus) ||
    0;
  const diff =
    typeof value.diff === "string" && value.diff.trim() ? truncateDiff(value.diff) : undefined;
  return {
    path,
    type: normalizeChangeType(value.type || value.kind),
    added: Math.max(0, Math.floor(added)),
    removed: Math.max(0, Math.floor(removed)),
    diff,
  };
}

function extractToolFileChanges(tool: ToolCall): FileChangeItem[] {
  const args = tool.arguments || tool.args || {};
  const result = isRecord(tool.result) ? tool.result : null;
  const toolName = tool.name.toLowerCase();
  const parsedFromResult: FileChangeItem[] = [];

  if (result && Array.isArray(result.changes)) {
    for (const change of result.changes) {
      const parsed = parseChangeRecord(change);
      if (parsed) parsedFromResult.push(parsed);
    }
  }

  if (result && isRecord(result.change)) {
    const parsed = parseChangeRecord({
      path:
        (typeof result.path === "string" && result.path) ||
        (typeof args.path === "string" && args.path) ||
        "",
      ...(result.change as Record<string, unknown>),
    });
    if (parsed) parsedFromResult.push(parsed);
  }

  if (parsedFromResult.length > 0) {
    return parsedFromResult;
  }

  if (toolName === "apply_patch") {
    const patch = typeof args.patch === "string" ? args.patch : "";
    if (patch.trim()) {
      return parsePatchFileChanges(patch);
    }
    return [];
  }

  if (toolName === "write") {
    const path =
      (typeof args.path === "string" && args.path) ||
      (result && typeof result.path === "string" ? result.path : "");
    const content = typeof args.content === "string" ? args.content : "";
    if (!path || !content) return [];
    return [
      {
        path,
        type: "created",
        added: countLines(content),
        removed: 0,
        diff: buildSimpleDiff(path, "", content),
      },
    ];
  }

  if (toolName === "edit") {
    const path =
      (typeof args.path === "string" && args.path) ||
      (result && typeof result.path === "string" ? result.path : "");
    const before = typeof args.oldText === "string" ? args.oldText : "";
    const after = typeof args.newText === "string" ? args.newText : "";
    if (!path || (!before && !after)) return [];
    return [
      {
        path,
        type: "updated",
        added: countLines(after),
        removed: countLines(before),
        diff: buildSimpleDiff(path, before, after),
      },
    ];
  }

  return [];
}

function summarizeMessageFileChanges(toolCalls?: ToolCall[]): FileChangeSummary | null {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;

  const byPath = new Map<string, FileChangeItem>();
  for (const tool of toolCalls) {
    const changes = extractToolFileChanges(tool);
    for (const change of changes) {
      if (!change.path) continue;
      const existing = byPath.get(change.path);
      if (!existing) {
        byPath.set(change.path, { ...change });
        continue;
      }

      existing.added += change.added;
      existing.removed += change.removed;
      if (change.diff) existing.diff = change.diff;
      if (change.type === "deleted") existing.type = "deleted";
      if (existing.type !== "deleted" && change.type === "updated") existing.type = "updated";
    }
  }

  const files = Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) return null;

  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
  return { files, totalAdded, totalRemoved };
}

function summarizeSessionFileChanges(messages: ChatMessage[]): FileChangeSummary | null {
  const toolCalls: ToolCall[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) continue;
    toolCalls.push(...getToolCallsInTimelineOrder(message.tool_calls));
  }
  return summarizeMessageFileChanges(toolCalls);
}

function SubagentCallItem({
  subagent,
}: {
  subagent: { id: string; task: string; status: string };
}) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    running: {
      color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    completed: {
      color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
      icon: <div className="w-2 h-2 rounded-full bg-emerald-400" />,
    },
    failed: {
      color: "text-red-400 border-red-500/30 bg-red-500/10",
      icon: <div className="w-2 h-2 rounded-full bg-red-400" />,
    },
    killed: {
      color: "text-gray-400 border-gray-500/30 bg-gray-500/10",
      icon: <div className="w-2 h-2 rounded-full bg-gray-400" />,
    },
  };

  const config = statusConfig[subagent.status as keyof typeof statusConfig] || statusConfig.running;

  return (
    <div className={`rounded-lg border ${config.color} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-sm"
      >
        {config.icon}
        <Zap className="w-3 h-3" />
        <span className="font-medium truncate">Subagent: {subagent.task.slice(0, 50)}...</span>
        <span className="flex-1" />
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-white/10">
          <div className="mt-2">
            <p className="text-[12px] text-gray-500 mb-1">Task:</p>
            <p className="text-sm text-gray-300">{subagent.task}</p>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-[12px] text-gray-500">
              ID: <code className="text-gray-400">{subagent.id}</code>
            </p>
            <Badge
              variant={
                subagent.status === "completed"
                  ? "success"
                  : subagent.status === "failed"
                    ? "error"
                    : "default"
              }
              size="sm"
            >
              {subagent.status}
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveActivityTimeline({
  status,
  activities,
  currentStep,
}: {
  status: "thinking" | "generating" | "idle";
  activities: LiveActivityItem[];
  currentStep?: string | null;
}) {
  const visibleActivities = activities.filter((activity) => !isGenericStatusLabel(activity.text));
  const activeStartStep = getLatestInFlightStep(visibleActivities);
  const explicitCurrentStep =
    typeof currentStep === "string" && currentStep.trim().length > 0 ? currentStep.trim() : null;
  const normalizedCurrentStep =
    explicitCurrentStep && !isGenericStatusLabel(explicitCurrentStep) ? explicitCurrentStep : null;
  const displayCurrentStep = activeStartStep
    ? null
    : normalizedCurrentStep ||
      (status === "generating"
        ? "Generating response..."
        : status === "thinking"
          ? "Thinking..."
          : null);

  return (
    <div className="space-y-1">
      {visibleActivities.length > 0 && (
        <div className="space-y-1">
          {visibleActivities.map((activity) => (
            <div
              key={activity.id}
              className={cn(
                "flex items-start gap-2 text-[12px] px-0.5",
                activity.toolName === "__thought" ? "text-gray-200" : "text-gray-400"
              )}
            >
              {activity.toolName === "__thought" ? (
                <Sparkles className="w-3 h-3 text-indigo-300 mt-0.5 flex-shrink-0" />
              ) : activity.phase === "start" ? (
                <Loader2 className="w-3 h-3 animate-spin text-amber-400 mt-0.5 flex-shrink-0" />
              ) : activity.phase === "result" ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <ActivityText text={activity.text} />
                {activity.toolName !== "__thought" && activity.sandboxProvider && (
                  <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] leading-none text-sky-200">
                    {formatSandboxProviderLabel(activity.sandboxProvider)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {displayCurrentStep ? (
        <div className="flex items-start gap-2 text-[12px] px-0.5 text-gray-300">
          <Loader2 className="w-3 h-3 animate-spin text-amber-400 mt-0.5 flex-shrink-0" />
          <span className="whitespace-pre-wrap break-words">{displayCurrentStep}</span>
        </div>
      ) : visibleActivities.length === 0 ? (
        <div className="flex gap-1 px-1">
          <span
            className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ProcessActivityList({ activities }: { activities: LiveActivityItem[] }) {
  if (activities.length === 0) return null;

  const visibleActivities = activities.filter((activity) => !isGenericStatusLabel(activity.text));
  if (visibleActivities.length === 0) return null;

  return (
    <div className="space-y-1">
      {visibleActivities.map((activity) => (
        <div
          key={activity.id}
          className={cn(
            "flex items-start gap-1.5 text-[12px] px-0.5",
            activity.toolName === "__thought" ? "text-gray-200" : "text-gray-400"
          )}
        >
          {activity.toolName === "__thought" ? (
            <Sparkles className="h-3 w-3 text-indigo-300 mt-0.5 flex-shrink-0" />
          ) : activity.phase === "start" ? (
            <Loader2 className="h-3 w-3 animate-spin text-amber-400 mt-0.5 flex-shrink-0" />
          ) : activity.phase === "result" ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-3 w-3 text-rose-400 mt-0.5 flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <ActivityText text={activity.text} />
            {activity.toolName !== "__thought" && activity.sandboxProvider && (
              <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] leading-none text-sky-200">
                {formatSandboxProviderLabel(activity.sandboxProvider)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityStepCard({ activity, isLast }: { activity: LiveActivityItem; isLast: boolean }) {
  const phaseStyles = {
    start: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    result: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    error: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  } as const;

  const phaseIcon =
    activity.phase === "start" ? (
      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />
    ) : activity.phase === "result" ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
    ) : (
      <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
    );

  return (
    <div className="relative pl-6">
      {!isLast && (
        <div className="absolute left-[10px] top-5 h-[calc(100%-8px)] w-px bg-white/10" />
      )}
      <div className="absolute left-0 top-1.5 h-5 w-5 rounded-full border border-white/10 bg-[#090b13] flex items-center justify-center">
        {phaseIcon}
      </div>
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-[12px] leading-5 backdrop-blur-sm",
          phaseStyles[activity.phase]
        )}
      >
        <div className="min-w-0 flex items-center gap-2">
          <ActivityText text={activity.text} />
          {activity.toolName !== "__thought" && activity.sandboxProvider && (
            <span className="inline-flex items-center rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] leading-none text-sky-200">
              {formatSandboxProviderLabel(activity.sandboxProvider)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityText({ text }: { text: string }) {
  const shouldHighlightCounters = /^(Edited|Created|Updated|Deleted)\b/i.test(text);
  if (!shouldHighlightCounters) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }

  const parts = text.split(/(\s\+\d+\b|\s-\d+\b)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (/^\s\+\d+$/.test(part)) {
          return (
            <span key={`activity-text-${index}`} className="text-green-300">
              {part}
            </span>
          );
        }
        if (/^\s-\d+$/.test(part)) {
          return (
            <span key={`activity-text-${index}`} className="text-red-300">
              {part}
            </span>
          );
        }
        return <span key={`activity-text-${index}`}>{part}</span>;
      })}
    </span>
  );
}

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

function getToolCallsInTimelineOrder(toolCalls?: ToolCall[]): ToolCall[] {
  if (!Array.isArray(toolCalls) || toolCalls.length <= 1) {
    return toolCalls ? [...toolCalls] : [];
  }

  const hasTimelineIndexes = toolCalls.some(
    (toolCall) =>
      typeof toolCall.timeline_index === "number" && Number.isFinite(toolCall.timeline_index)
  );
  if (hasTimelineIndexes) {
    return [...toolCalls].sort((a, b) => {
      const rankA =
        typeof a.timeline_index === "number" && Number.isFinite(a.timeline_index)
          ? a.timeline_index
          : Number.MAX_SAFE_INTEGER;
      const rankB =
        typeof b.timeline_index === "number" && Number.isFinite(b.timeline_index)
          ? b.timeline_index
          : Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    });
  }

  const hasStartTimestamps = toolCalls.some(
    (toolCall) => typeof toolCall.started_at === "number" && Number.isFinite(toolCall.started_at)
  );
  if (hasStartTimestamps) {
    return [...toolCalls].sort((a, b) => {
      const rankA =
        typeof a.started_at === "number" && Number.isFinite(a.started_at)
          ? a.started_at
          : Number.MAX_SAFE_INTEGER;
      const rankB =
        typeof b.started_at === "number" && Number.isFinite(b.started_at)
          ? b.started_at
          : Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    });
  }

  return [...toolCalls];
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

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  md: "markdown",
  yml: "yaml",
  py: "python",
  rb: "ruby",
  rs: "rust",
  csharp: "c",
  plain: "plaintext",
  text: "plaintext",
};

function extractTextContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => extractTextContent(child)).join("");
  }
  if (isValidElement(node)) {
    return extractTextContent((node.props as { children?: unknown }).children);
  }
  return "";
}

function normalizeCodeLanguage(rawLanguage?: string): string {
  if (!rawLanguage) return "plaintext";
  const key = rawLanguage.trim().toLowerCase();
  return CODE_LANGUAGE_ALIASES[key] || key || "plaintext";
}

function looksLikeDiffCode(code: string, language: string): boolean {
  if (language === "diff" || language === "patch") {
    return true;
  }
  const previewLines = code.split(/\r?\n/).slice(0, 12);
  return previewLines.some((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("diff --git") ||
      trimmed.startsWith("@@") ||
      trimmed.startsWith("+++ ") ||
      trimmed.startsWith("--- ")
    );
  });
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch (error) {
      console.error("Failed to copy code block:", error);
    }
  }, [code]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[12px] text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
      title={copied ? "Copied" : "Copy code"}
      aria-label={copied ? "Copied code block" : "Copy code block"}
    >
      {copied ? (
        <>
          <Check className="w-3 h-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          Copy
        </>
      )}
    </button>
  );
}

function InlineCodeSnippet({
  code,
  className,
  codeProps,
}: {
  code: string;
  className?: string;
  codeProps?: ComponentPropsWithoutRef<"code">;
}) {
  return (
    <code
      className={cn(
        "inline rounded-md border border-white/15 bg-white/[0.07] px-1.5 py-0.5 align-baseline font-mono text-[0.85em] text-indigo-100 whitespace-normal break-words",
        className
      )}
      {...codeProps}
    >
      {code}
    </code>
  );
}

function DiffCodeBlock({ code }: { code: string }) {
  const lines = code.split(/\r?\n/);

  const lineMeta = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("diff --git") || trimmed.startsWith("index ")) {
      return {
        prefix: "·",
        rowClass: "bg-white/[0.02]",
        numberClass: "text-gray-500",
        markerClass: "text-gray-400",
        textClass: "text-gray-300",
      };
    }
    if (trimmed.startsWith("@@") || trimmed.startsWith("+++ ") || trimmed.startsWith("--- ")) {
      return {
        prefix: "↕",
        rowClass: "bg-blue-500/10",
        numberClass: "text-blue-300/80",
        markerClass: "text-blue-300",
        textClass: "text-blue-200",
      };
    }
    if (line.startsWith("+")) {
      return {
        prefix: "+",
        rowClass: "bg-green-500/12",
        numberClass: "text-green-300/80",
        markerClass: "text-green-300",
        textClass: "text-green-200",
      };
    }
    if (line.startsWith("-")) {
      return {
        prefix: "−",
        rowClass: "bg-red-500/12",
        numberClass: "text-red-300/80",
        markerClass: "text-red-300",
        textClass: "text-red-200",
      };
    }
    return {
      prefix: " ",
      rowClass: "",
      numberClass: "text-gray-500",
      markerClass: "text-gray-400",
      textClass: "text-gray-300",
    };
  });

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] uppercase tracking-[0.08em] text-gray-400">
        <span>diff</span>
        <CopyCodeButton code={code} />
      </div>
      <pre className="m-0 overflow-x-auto font-mono text-[12px] leading-6">
        {lines.map((line, index) => (
          <div
            key={`diff-${index}`}
            className={cn(
              "grid grid-cols-[48px_20px_minmax(0,1fr)] items-start px-2",
              lineMeta[index]?.rowClass
            )}
          >
            <span
              className={cn(
                "select-none pr-2 text-right text-[12px]",
                lineMeta[index]?.numberClass
              )}
            >
              {index + 1}
            </span>
            <span
              className={cn("select-none text-center text-[12px]", lineMeta[index]?.markerClass)}
            >
              {lineMeta[index]?.prefix}
            </span>
            <span className={cn("whitespace-pre", lineMeta[index]?.textClass)}>
              {line || "\u00A0"}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function SyntaxCodeBlock({ code, language }: { code: string; language: string }) {
  const displayLanguage = language === "plaintext" ? "text" : language;
  const lineCount = code ? code.split(/\r?\n/).length : 0;
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-black/55 shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] uppercase tracking-[0.08em] text-gray-400">
        <span className="inline-flex items-center gap-2">
          <span>{displayLanguage}</span>
          <span className="text-[10px] normal-case tracking-normal text-gray-500">
            {lineCount} lines
          </span>
        </span>
        <CopyCodeButton code={code} />
      </div>
      <Highlight theme={themes.nightOwl} code={code || " "} language={language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(className, "m-0 overflow-x-auto p-3 text-[12px] leading-6")}
            style={{ ...style, background: "transparent" }}
          >
            {tokens.map((line, lineIndex) => (
              <div key={`line-${lineIndex}`} {...getLineProps({ line })}>
                {line.length > 0
                  ? line.map((token, tokenIndex) => (
                      <span key={`${lineIndex}-${tokenIndex}`} {...getTokenProps({ token })} />
                    ))
                  : "\u00A0"}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  type MarkdownPreProps = ComponentPropsWithoutRef<"pre">;
  type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & { inline?: boolean };
  const cleanedContent = useMemo(() => preprocessChatMarkdown(content), [content]);

  return (
    <div className="max-w-none text-[12px] text-gray-200 leading-[1.45rem]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }: MarkdownPreProps) => <>{children}</>,
          code({ className, children, inline, ...props }: MarkdownCodeProps) {
            const rawCode = extractTextContent(children).replace(/\n$/, "");
            const inferredInline = !className && !rawCode.includes("\n");
            if (inline ?? inferredInline) {
              return <InlineCodeSnippet code={rawCode} className={className} codeProps={props} />;
            }

            const languageMatch = className ? /language-([^\s]+)/.exec(className) : null;
            const language = normalizeCodeLanguage(languageMatch?.[1]);
            if (looksLikeDiffCode(rawCode, language)) {
              return <DiffCodeBlock code={rawCode} />;
            }

            return <SyntaxCodeBlock code={rawCode} language={language} />;
          },
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
          li: ({ children }) => <li className="mb-1">{children}</li>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03]">
              <table className="w-full text-[12px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-white/10 last:border-b-0">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="text-left font-semibold text-gray-100 px-3 py-2 align-top">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="px-3 py-2 align-top text-gray-300">{children}</td>,
          h1: ({ children }) => <h1 className="text-xl font-bold mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-bold mb-2">{children}</h3>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-indigo-400 hover:text-indigo-300 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-indigo-500 pl-3 my-2 text-gray-400">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="border-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent my-4" />
          ),
        }}
      >
        {cleanedContent}
      </ReactMarkdown>
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
