import {
  finalizeCompletedActivities,
  mergeActivityLists,
  normalizeActivityTextForPhase,
  type LiveActivityItem,
} from "@/lib/chatActivities";
import type { PendingChatMessage } from "@/lib/status-stream";
export interface ToolCall {
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

export interface ArtifactSummaryView {
  sessionId: string;
  name: string;
  fileName: string;
  title: string;
  path?: string;
}

export interface ChatMessage {
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
    sandboxProvider?: string;
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

export interface FileChangeItem {
  path: string;
  type: "created" | "updated" | "deleted";
  added: number;
  removed: number;
  diff?: string;
}

export interface FileChangeSummary {
  files: FileChangeItem[];
  totalAdded: number;
  totalRemoved: number;
}

export interface RevertTarget {
  index: number;
  content: string;
  timestamp?: string;
}

export interface StatusStreamEvent {
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

export interface SessionStatusActivity {
  id: string;
  phase: "start" | "result" | "error";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface SessionStatusSnapshot {
  sessionId: string;
  status: string;
  timestamp: number;
  detail?: string;
  agentId?: string;
  activities: SessionStatusActivity[];
  pendingMessages?: PendingChatMessage[];
}

export interface SessionStatusResponse {
  activeSessions?: SessionStatusSnapshot[];
  activeSessionIds: string[];
  count?: number;
  session?: SessionStatusSnapshot | null;
  active?: boolean;
  sessionId?: string;
}

export interface SpeechRecognitionResultLike {
  transcript?: string;
}

export interface SpeechRecognitionAlternativeLike {
  0?: SpeechRecognitionResultLike;
  isFinal?: boolean;
}

export interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results?: ArrayLike<SpeechRecognitionAlternativeLike>;
}

export interface SpeechRecognitionErrorLike {
  error?: string;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

export type DictationMode = "auto" | "native" | "openai";
export type DictationEngine = "native" | "recording";

export interface DictationRuntimeCapabilities {
  nativeRecognition: boolean;
  mediaRecorder: boolean;
  microphone: boolean;
}

export interface DictationRuntimeResolution {
  engine: DictationEngine | null;
  label: string;
  unsupportedReason: string | null;
}

export function normalizeDictationMode(value: unknown): DictationMode {
  if (value === "native" || value === "openai") return value;
  return "auto";
}

export function resolveDictationRuntime(
  mode: DictationMode,
  capabilities: DictationRuntimeCapabilities
): DictationRuntimeResolution {
  const recordingAvailable = capabilities.microphone && capabilities.mediaRecorder;
  if (mode === "native") {
    return capabilities.nativeRecognition
      ? { engine: "native", label: "Native dictation", unsupportedReason: null }
      : {
          engine: null,
          label: "Native dictation unavailable",
          unsupportedReason:
            "Native dictation is not available in this browser or desktop runtime.",
        };
  }
  if (mode === "openai") {
    return recordingAvailable
      ? { engine: "recording", label: "Model transcription", unsupportedReason: null }
      : {
          engine: null,
          label: "Model transcription unavailable",
          unsupportedReason: capabilities.microphone
            ? "This runtime cannot record audio for model transcription."
            : "Microphone capture is not available in this browser or desktop runtime.",
        };
  }
  if (capabilities.nativeRecognition) {
    return { engine: "native", label: "Native dictation", unsupportedReason: null };
  }
  if (recordingAvailable) {
    return { engine: "recording", label: "Model transcription", unsupportedReason: null };
  }
  return {
    engine: null,
    label: "Dictation unavailable",
    unsupportedReason: "No native dictation or microphone recording support is available here.",
  };
}

export interface PendingProcessCapture {
  assistantCountBefore: number;
  activities: LiveActivityItem[];
  sessionId: string | null;
  agentId?: string;
  createdAt: number;
}

export const LAST_WORKSPACE_STORAGE_KEY = "cybara:lastWorkspaceDir";
export const LAST_SESSION_STORAGE_KEY = "cybara:lastSessionId";
export const MESSAGE_PROCESS_MAP_STORAGE_KEY = "cybara:messageProcessMap";
export const DIFF_PANEL_WIDTH_STORAGE_KEY = "cybara:chatDiffPanelWidth";
export const SESSION_ACTIVITY_STALE_MS = 30_000;
export const PENDING_CAPTURE_TIMEOUT_MS = 90_000;
export const DIFF_PANEL_DEFAULT_WIDTH = 560;
export const DIFF_PANEL_MIN_WIDTH = 380;
export const DIFF_PANEL_MAX_WIDTH = 1120;

export function getMessageProcessKey(
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

export function getLegacyMessageProcessKey(
  sessionKey: string | null,
  message: ChatMessage,
  fallbackIndex: number
): string {
  return `${sessionKey || "default"}:${message.timestamp || fallbackIndex}`;
}

export function getMessageProcessActivities(
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

function liveActivityCanonicalKey(activity: LiveActivityItem): string | null {
  const text = typeof activity.text === "string" ? activity.text.trim() : "";
  if (!text) return null;
  return [
    activity.phase || "result",
    text,
    typeof activity.toolName === "string" ? activity.toolName.trim().toLowerCase() : "",
    typeof activity.toolCallId === "string" ? activity.toolCallId.trim().toLowerCase() : "",
  ].join("\u0000");
}

export function pruneCanonicalizedLiveActivities(
  messages: ChatMessage[],
  activities: LiveActivityItem[]
): LiveActivityItem[] {
  if (activities.length === 0 || messages.length === 0) return activities;
  const embeddedIds = new Set<string>();
  const embeddedKeys = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.process_activities)) continue;
    for (const entry of message.process_activities) {
      const activity = normalizePersistedLiveActivityItem(entry);
      if (!activity) continue;
      if (activity.id.trim()) {
        embeddedIds.add(activity.id.trim());
      }
      const key = liveActivityCanonicalKey(activity);
      if (key) {
        embeddedKeys.add(key);
      }
    }
  }
  if (embeddedIds.size === 0 && embeddedKeys.size === 0) return activities;
  return activities.filter((activity) => {
    if (activity.id && embeddedIds.has(activity.id.trim())) return false;
    const key = liveActivityCanonicalKey(activity);
    return !key || !embeddedKeys.has(key);
  });
}

function parseChatMessageTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function buildPreSteeringActivityMessage(
  steeringMessage: ChatMessage,
  activities: LiveActivityItem[]
): ChatMessage | null {
  const processActivities = finalizeCompletedActivities(activities).filter((activity) => {
    const text = activity.text.trim().toLowerCase();
    return (
      text.length > 0 && text !== "steering to follow-up..." && text !== "starting queued follow-up"
    );
  });
  if (processActivities.length === 0) return null;
  const steeringTimestampMs = parseChatMessageTimestampMs(steeringMessage.timestamp) ?? Date.now();
  return {
    role: "assistant",
    content: "",
    timestamp: new Date(Math.max(0, steeringTimestampMs - 1)).toISOString(),
    process_activities: processActivities.map((activity) => ({
      id: activity.id,
      phase: activity.phase,
      text: activity.text,
      timestamp: activity.timestamp,
      toolName: activity.toolName,
      toolCallId: activity.toolCallId,
      sandboxProvider: activity.sandboxProvider,
    })),
  };
}

export function readStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function readPersistedWorkspaceDir(): string | null {
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

export function persistWorkspaceDir(workspaceDir: string | null): void {
  if (typeof window === "undefined" || !workspaceDir) return;
  try {
    const trimmed = workspaceDir.trim();
    if (!trimmed) return;
    window.localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, trimmed);
  } catch {
    // Ignore local storage errors
  }
}

export function readPersistedSessionId(): string | null {
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

export function clampDiffPanelWidth(value: number): number {
  return Math.max(DIFF_PANEL_MIN_WIDTH, Math.min(DIFF_PANEL_MAX_WIDTH, value));
}

export function readPersistedDiffPanelWidth(): number {
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

export function persistDiffPanelWidth(width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DIFF_PANEL_WIDTH_STORAGE_KEY, String(clampDiffPanelWidth(width)));
  } catch {
    // Ignore local storage errors
  }
}

export function persistSessionId(sessionId: string | null): void {
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

export function normalizePersistedLiveActivityItem(value: unknown): LiveActivityItem | null {
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

export function normalizeMessageProcessActivities(
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

export function readPersistedMessageProcessMap(): Record<string, LiveActivityItem[]> {
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

export function persistMessageProcessMap(map: Record<string, LiveActivityItem[]>): void {
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

export function readNumberArg(args: Record<string, unknown>, keys: string[]): number | undefined {
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

export function formatWorkspaceLabel(path: string, maxLength = 44): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const tail = segments.length > 0 ? segments[segments.length - 1] : normalized;
  if (normalized.length <= maxLength) return normalized;
  if (tail.length + 4 >= maxLength) return `.../${tail.slice(-(maxLength - 4))}`;
  const prefixLength = Math.max(0, maxLength - tail.length - 4);
  return `${normalized.slice(0, prefixLength)}.../${tail}`;
}

export function displayProviderLabel(value?: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .trim()
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function sessionRouteLabel(session: Record<string, unknown>): string | null {
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

export function sessionDisplayTitle(session: Record<string, unknown>): string {
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

export const SESSION_PREVIEW_LIMIT = 160;

export function sessionPreviewText(content: unknown, limit = SESSION_PREVIEW_LIMIT): string | null {
  if (typeof content !== "string") return null;
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

export function toActivityPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

export function isGenericStatusLabel(detail: string): boolean {
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

export function isMeaningfulThoughtDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) return false;
  return !isGenericStatusLabel(normalized);
}

export function getLatestInFlightStep(activities: LiveActivityItem[]): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.phase !== "start") continue;
    const step = activity.text?.trim() || "";
    if (!step || isGenericStatusLabel(step)) continue;
    return step;
  }
  return null;
}

export function normalizeSnapshotActivities(
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

export function resolveStatusSnapshotActivities(
  snapshotActivities: LiveActivityItem[],
  localActivities: LiveActivityItem[],
  status: string
): LiveActivityItem[] {
  const normalizedStatus = status.trim().toLowerCase();
  if (
    snapshotActivities.length === 0 &&
    localActivities.length > 0 &&
    normalizedStatus !== "idle" &&
    normalizedStatus !== "error"
  ) {
    return mergeActivityLists([], localActivities);
  }
  return snapshotActivities;
}

export function summarizeCommand(command: string): string {
  const compact = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (!compact) return "command";
  if (compact.length > 72) return `${compact.slice(0, 69)}...`;
  return compact;
}

export function formatToolIntent(
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

export function normalizeSessionStatus(
  status: string
): "thinking" | "generating" | "compacting" | "idle" {
  if (status === "generating") return "generating";
  if (status === "compacting") return "compacting";
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

export function toLiveActivityItems(
  activities: SessionStatusActivity[] | undefined
): LiveActivityItem[] {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeArtifactFileName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.endsWith(".md.resolved")) return trimmed;
  return `${trimmed.replace(/\.md\.resolved$/i, "")}.md.resolved`;
}

export function tryParseJsonRecord(value: unknown): unknown {
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

export function normalizeSandboxProviderValue(value: unknown): string | undefined {
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

export function formatSandboxProviderLabel(provider: string): string {
  if (provider === "apple_sandbox") return "Apple Sandbox";
  if (provider === "podman") return "Podman";
  if (provider === "docker") return "Docker";
  if (provider === "host") return "Host";
  return provider;
}

export function resolveToolCallSandboxProvider(toolCall: ToolCall): string | undefined {
  const parsedResult = tryParseJsonRecord(toolCall.result);
  if (!isRecord(parsedResult)) return undefined;
  return normalizeSandboxProviderValue(
    parsedResult.sandboxProvider ?? parsedResult.sandbox_provider
  );
}

export function parseArtifactSummary(value: unknown): ArtifactSummaryView | null {
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

export function parseArtifactSummaries(value: unknown): ArtifactSummaryView[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => parseArtifactSummary(entry))
    .filter((entry): entry is ArtifactSummaryView => entry !== null);
}

export function dedupeArtifactSummaries(summaries: ArtifactSummaryView[]): ArtifactSummaryView[] {
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

export function inferArtifactSummaries(
  tool: ToolCall,
  sessionId?: string | null
): ArtifactSummaryView[] {
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

export function countLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

export function truncateDiff(diff: string, maxLines = 220): string {
  const lines = diff.split(/\r?\n/);
  if (lines.length <= maxLines) return diff;
  const omitted = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `... [diff truncated, ${omitted} lines omitted]`].join("\n");
}

export function normalizeChangeType(raw: unknown): FileChangeItem["type"] {
  const type = typeof raw === "string" ? raw.toLowerCase() : "";
  if (type === "created" || type === "create" || type === "new") return "created";
  if (type === "deleted" || type === "delete" || type === "remove") return "deleted";
  return "updated";
}

export function toFiniteNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function buildSimpleDiff(path: string, before: string, after: string): string {
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

export function extractFirstTargetLine(diff?: string): number | undefined {
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

export function resolvePathForIde(path: string, workspaceDir: string | null): string {
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

export function parsePatchFileChanges(patch: string): FileChangeItem[] {
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

export function parseChangeRecord(value: unknown): FileChangeItem | null {
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

export function extractToolFileChanges(tool: ToolCall): FileChangeItem[] {
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

export function summarizeMessageFileChanges(toolCalls?: ToolCall[]): FileChangeSummary | null {
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

export function summarizeSessionFileChanges(messages: ChatMessage[]): FileChangeSummary | null {
  const toolCalls: ToolCall[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) continue;
    toolCalls.push(...getToolCallsInTimelineOrder(message.tool_calls));
  }
  return summarizeMessageFileChanges(toolCalls);
}

export function getToolCallsInTimelineOrder(toolCalls?: ToolCall[]): ToolCall[] {
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

const STREAM_REASONING_TAG =
  "(?:REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning)";
const STREAM_REASONING_BLOCK_PATTERN = new RegExp(
  `<${STREAM_REASONING_TAG}\\b[^>]*>[\\s\\S]*?</${STREAM_REASONING_TAG}>`,
  "gi"
);
const STREAM_REASONING_CLOSE_PATTERN = new RegExp(`</${STREAM_REASONING_TAG}\\b[^>]*>`, "gi");
const STREAM_REASONING_OPEN_PATTERN = new RegExp(`<${STREAM_REASONING_TAG}\\b[^>]*>`, "i");

/**
 * Reduce a raw streaming buffer to the text that should be shown as the
 * assistant's answer. Reasoning is hidden while it streams:
 * - paired <think>...</think> blocks are removed;
 * - an unpaired closing tag means the opener was implicit (DeepSeek-style),
 *   so everything up to the last close is reasoning;
 * - an unclosed opening tag means reasoning is still streaming, so the tail
 *   is hidden until the block closes.
 */
export function stripStreamingReasoningForDisplay(text: string): string {
  let result = text.replace(STREAM_REASONING_BLOCK_PATTERN, "");

  STREAM_REASONING_CLOSE_PATTERN.lastIndex = 0;
  let lastCloseEnd = -1;
  for (const match of result.matchAll(STREAM_REASONING_CLOSE_PATTERN)) {
    lastCloseEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastCloseEnd >= 0) {
    result = result.slice(lastCloseEnd);
  }

  const openMatch = result.match(STREAM_REASONING_OPEN_PATTERN);
  if (openMatch && typeof openMatch.index === "number") {
    result = result.slice(0, openMatch.index);
  }

  return result.replace(/^\s+/, "");
}
