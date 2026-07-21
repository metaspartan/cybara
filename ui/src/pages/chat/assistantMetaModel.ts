import type { LiveActivityItem } from "@/lib/chatActivities";
import {
  type ArtifactSummaryView,
  dedupeArtifactSummaries,
  inferArtifactSummaries,
  isRecord,
  type ToolCall,
  tryParseJsonRecord,
} from "./chatModel";

export function formatWorkedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export function parseTimestampMs(value: unknown): number | undefined {
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

export function inferThoughtActivitiesFromContent(
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
    if (!line || toolishLine.test(line) || !thoughtishLine.test(line)) continue;
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

export function inferThoughtActivitiesFromThinking(
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

interface WorkedDurationOptions {
  assistantTimestamp?: string;
  turnStartedAtMs?: number;
  workedDurationMs?: number;
}

export function resolveWorkedDurationMs(
  processActivities?: LiveActivityItem[],
  toolCalls?: ToolCall[],
  options?: WorkedDurationOptions
): number | undefined {
  if (
    typeof options?.workedDurationMs === "number" &&
    Number.isFinite(options.workedDurationMs) &&
    options.workedDurationMs >= 0
  ) {
    return options.workedDurationMs;
  }
  const assistantTimestampMs = parseTimestampMs(options?.assistantTimestamp);
  const turnStartedAtMs = options?.turnStartedAtMs;
  const withinTurnBounds = (timestamp: number): boolean => {
    if (!Number.isFinite(timestamp)) return false;
    if (
      typeof turnStartedAtMs === "number" &&
      Number.isFinite(turnStartedAtMs) &&
      turnStartedAtMs > 0 &&
      timestamp + 1_000 < turnStartedAtMs
    ) {
      return false;
    }
    return !(typeof assistantTimestampMs === "number" && timestamp > assistantTimestampMs + 1_000);
  };
  const activityTimestamps = (processActivities ?? [])
    .map((activity) => activity.timestamp)
    .filter((timestamp): timestamp is number => withinTurnBounds(timestamp));
  const granularDurationCandidates: number[] = [];
  const addGranularDuration = (value: number | undefined): void => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
    granularDurationCandidates.push(value);
  };

  if (activityTimestamps.length >= 2) {
    addGranularDuration(Math.max(...activityTimestamps) - Math.min(...activityTimestamps));
  }
  if (activityTimestamps.length > 0 && typeof assistantTimestampMs === "number") {
    addGranularDuration(assistantTimestampMs - Math.min(...activityTimestamps));
  }

  const toolStartTimestamps = (toolCalls ?? [])
    .map((toolCall) => parseTimestampMs(toolCall.started_at))
    .filter(
      (timestamp): timestamp is number =>
        typeof timestamp === "number" && withinTurnBounds(timestamp)
    );
  if (toolStartTimestamps.length > 0) {
    const minStart = Math.min(...toolStartTimestamps);
    const maxEnd = (toolCalls ?? []).reduce((currentMax, toolCall) => {
      const startedAt = parseTimestampMs(toolCall.started_at);
      if (typeof startedAt !== "number" || !withinTurnBounds(startedAt)) return currentMax;
      const duration = parseDurationMs(toolCall.duration);
      return Math.max(currentMax, duration > 0 ? startedAt + duration : startedAt);
    }, minStart);
    addGranularDuration(maxEnd - minStart);
  }

  addGranularDuration(
    (toolCalls ?? []).reduce((sum, toolCall) => sum + parseDurationMs(toolCall.duration), 0)
  );

  if (granularDurationCandidates.length > 0) {
    return Math.max(...granularDurationCandidates);
  }

  if (
    typeof assistantTimestampMs === "number" &&
    typeof turnStartedAtMs === "number" &&
    Number.isFinite(turnStartedAtMs)
  ) {
    const wallDuration = assistantTimestampMs - turnStartedAtMs;
    return Number.isFinite(wallDuration) && wallDuration > 0 ? wallDuration : undefined;
  }

  return undefined;
}

const ARTIFACT_MUTATION_ACTIONS = new Set(["create", "update", "append", "check"]);

function isArtifactMutationAction(action: string): boolean {
  return ARTIFACT_MUTATION_ACTIONS.has(action);
}

function resolveArtifactAction(toolCall: ToolCall): string | undefined {
  const args = toolCall.arguments ?? toolCall.args ?? {};
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
  return actionFromResult ? isArtifactMutationAction(actionFromResult) : false;
}

export function collectMessageArtifacts(
  toolCalls: ToolCall[] | undefined,
  sessionId?: string | null
): ArtifactSummaryView[] {
  const artifacts: ArtifactSummaryView[] = [];
  for (const toolCall of toolCalls ?? []) {
    if (toolCall.name !== "artifacts" && toolCall.name !== "artifact") continue;
    const action = resolveArtifactAction(toolCall);
    if (action ? !isArtifactMutationAction(action) : !hasArtifactMutationResult(toolCall)) {
      continue;
    }
    artifacts.push(...inferArtifactSummaries(toolCall, sessionId));
  }
  return dedupeArtifactSummaries(artifacts);
}
