import {
  type LiveActivityItem,
  mergeActivityLists,
  normalizeActivityTextForPhase,
} from "@/lib/chatActivities";
import { isGenericChatStatusLabel } from "../../../../shared/chat-status";

export function isGenericStatusLabel(detail: string): boolean {
  return isGenericChatStatusLabel(detail);
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

export function applyLiveActivityEvent(
  previous: LiveActivityItem[],
  event: {
    phase: "start" | "result" | "error" | "blocked";
    text: string;
    timestamp?: number;
    toolName?: string;
    toolCallId?: string;
    sandboxProvider?: string;
    imageSource?: string;
    imageAlt?: string;
    runId?: string;
    sequence?: number;
  }
): LiveActivityItem[] {
  const trimmed = event.text.trim();
  if (!trimmed) return previous;

  const normalizedText = normalizeActivityTextForPhase(trimmed, event.phase);
  if (isGenericStatusLabel(normalizedText)) return previous;
  const nextTimestamp =
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
      ? event.timestamp
      : Date.now();
  const normalizedToolName =
    typeof event.toolName === "string" ? event.toolName.trim().toLowerCase() : "";
  const normalizedToolCallId =
    typeof event.toolCallId === "string" && event.toolCallId.trim()
      ? event.toolCallId.trim().toLowerCase()
      : "";
  const normalizedSandboxProvider = normalizeSandboxProviderValue(event.sandboxProvider);
  const nextId =
    typeof event.runId === "string" &&
    event.runId.trim() &&
    typeof event.sequence === "number" &&
    Number.isFinite(event.sequence)
      ? `${event.runId.trim()}:${event.sequence}`
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sortAndMergeActivities = (items: LiveActivityItem[]): LiveActivityItem[] =>
    mergeActivityLists(
      [],
      [...items].sort((left, right) =>
        left.timestamp === right.timestamp
          ? left.id.localeCompare(right.id)
          : left.timestamp - right.timestamp
      )
    );

  if (event.phase !== "start") {
    if (normalizedToolCallId) {
      for (let index = previous.length - 1; index >= 0; index -= 1) {
        const candidate = previous[index];
        if (candidate.phase !== "start") continue;
        if ((candidate.toolCallId || "").trim().toLowerCase() !== normalizedToolCallId) continue;
        const updated = [...previous];
        updated[index] = {
          ...candidate,
          phase: event.phase,
          text: normalizedText,
          toolName: normalizedToolName || candidate.toolName,
          toolCallId: normalizedToolCallId,
          sandboxProvider: normalizedSandboxProvider || candidate.sandboxProvider,
          imageSource: event.imageSource || candidate.imageSource,
          imageAlt: event.imageAlt || candidate.imageAlt,
        };
        return sortAndMergeActivities(updated);
      }
    }

    if (normalizedToolName) {
      for (let index = previous.length - 1; index >= 0; index -= 1) {
        const candidate = previous[index];
        if (candidate.phase !== "start") continue;
        if ((candidate.toolName || "").trim().toLowerCase() !== normalizedToolName) continue;
        const updated = [...previous];
        updated[index] = {
          ...candidate,
          phase: event.phase,
          text: normalizedText,
          toolName: normalizedToolName,
          toolCallId: normalizedToolCallId || candidate.toolCallId,
          sandboxProvider: normalizedSandboxProvider || candidate.sandboxProvider,
          imageSource: event.imageSource || candidate.imageSource,
          imageAlt: event.imageAlt || candidate.imageAlt,
        };
        return sortAndMergeActivities(updated);
      }
    }

    for (let index = previous.length - 1; index >= 0; index -= 1) {
      const candidate = previous[index];
      if (candidate.phase !== "start") continue;
      if (normalizeActivityTextForPhase(candidate.text, event.phase) !== normalizedText) continue;
      const updated = [...previous];
      updated[index] = {
        ...candidate,
        phase: event.phase,
        text: normalizedText,
        toolName: normalizedToolName || candidate.toolName,
        toolCallId: normalizedToolCallId || candidate.toolCallId,
        sandboxProvider: normalizedSandboxProvider || candidate.sandboxProvider,
        imageSource: event.imageSource || candidate.imageSource,
        imageAlt: event.imageAlt || candidate.imageAlt,
      };
      return sortAndMergeActivities(updated);
    }
  }

  const previousLast = previous[previous.length - 1];
  if (
    previousLast &&
    previousLast.phase === event.phase &&
    normalizeActivityTextForPhase(previousLast.text, event.phase) === normalizedText &&
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

  return sortAndMergeActivities([
    ...previous,
    {
      id: nextId,
      phase: event.phase,
      text: normalizedText,
      timestamp: nextTimestamp,
      toolName: normalizedToolName || undefined,
      toolCallId: normalizedToolCallId || undefined,
      sandboxProvider: normalizedSandboxProvider,
      imageSource: event.imageSource,
      imageAlt: event.imageAlt,
    },
  ]);
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
