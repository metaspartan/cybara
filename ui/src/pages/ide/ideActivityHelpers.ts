/** IDE tool-call/status activity helpers — extracted from IDE.tsx. */
import type { ToolCallLike, LiveActivityItem } from "@/lib/chatActivities";
import { normalizeActivityTextForPhase } from "@/lib/chatActivities";
import { isPlainRecord } from "./ideDiffHelpers";
import type {
  IdeProcessActivity,
  IdePendingFileDiff,
  IdeChatMessage,
} from "./ideTypes";

export function getIdeToolCallArgs(toolCall: ToolCallLike): Record<string, unknown> | null {
  if (isPlainRecord(toolCall.args)) return toolCall.args;
  if (isPlainRecord(toolCall.arguments)) return toolCall.arguments;
  return null;
}

export function getIdeToolCallCommand(toolCall: ToolCallLike): string | null {
  const args = getIdeToolCallArgs(toolCall);
  if (!args) return null;
  const directCommand =
    (typeof args.command === "string" && args.command.trim()) ||
    (typeof args.cmd === "string" && args.cmd.trim()) ||
    "";
  if (directCommand) return directCommand;

  const toolName = typeof toolCall.name === "string" ? toolCall.name : "tool";
  const path =
    typeof args.path === "string" && args.path.trim()
      ? args.path.trim()
      : typeof args.file === "string" && args.file.trim()
        ? args.file.trim()
        : "";
  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
  const query = typeof args.query === "string" ? args.query.trim() : "";

  if (pattern && path) return `${toolName} "${pattern}" ${path}`;
  if (query) return `${toolName} "${query}"`;
  if (path) return `${toolName} ${path}`;
  return null;
}

export function getIdeToolCallResultSummary(
  toolCall: ToolCallLike,
  maxLength = 320
): string | null {
  const formatOutput = (value: string, maxChars = 2400, maxLines = 32): string => {
    const normalized = value.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";
    const lines = normalized.split("\n");
    let clipped = normalized;
    let truncated = false;
    if (lines.length > maxLines) {
      clipped = lines.slice(0, maxLines).join("\n");
      truncated = true;
    }
    if (clipped.length > maxChars) {
      clipped = `${clipped.slice(0, maxChars).trimEnd()}\n...`;
      truncated = true;
    }
    return truncated ? `${clipped}\n[output truncated]` : clipped;
  };

  const result = toolCall.result;
  if (typeof result === "string" && result.trim()) {
    const formatted = formatOutput(result);
    return formatted.length > maxLength && !formatted.includes("\n")
      ? `${formatted.slice(0, maxLength - 1)}…`
      : formatted;
  }
  if (!isPlainRecord(result)) return null;

  const keys = ["output", "stdout", "message", "error", "content", "diff"] as const;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) {
      const formatted = formatOutput(value);
      return formatted.length > maxLength && !formatted.includes("\n")
        ? `${formatted.slice(0, maxLength - 1)}…`
        : formatted;
    }
  }
  return null;
}

export function getIdeToolCallExitCode(toolCall: ToolCallLike): string | null {
  const result = toolCall.result;
  if (!isPlainRecord(result)) return null;
  const exitCode = result.exitCode;
  const code = result.code;
  if (typeof exitCode === "number" && Number.isFinite(exitCode)) return String(exitCode);
  if (typeof exitCode === "string" && exitCode.trim()) return exitCode.trim();
  if (typeof code === "number" && Number.isFinite(code)) return String(code);
  if (typeof code === "string" && code.trim()) return code.trim();
  return null;
}

export function parseIdeTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function normalizeIdeSandboxProviderValue(value: unknown): string | undefined {
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

export function formatIdeSandboxProviderLabel(provider: string): string {
  if (provider === "apple_sandbox") return "Apple Sandbox";
  if (provider === "podman") return "Podman";
  if (provider === "docker") return "Docker";
  if (provider === "host") return "Host";
  return provider;
}

export function isGenericIdeStatusLabel(detail: string): boolean {
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

export function isMeaningfulIdeThoughtDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) return false;
  return !isGenericIdeStatusLabel(normalized);
}

export function getLatestIdeInFlightStep(activities: LiveActivityItem[]): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.phase !== "start") continue;
    const step = activity.text?.trim() || "";
    if (!step || isGenericIdeStatusLabel(step)) continue;
    return step;
  }
  return null;
}

export function toIdeLiveActivityItems(
  activities:
    | Array<{
        id?: string;
        phase?: "start" | "result" | "error";
        text?: string;
        timestamp?: number;
        toolName?: string;
        toolCallId?: string;
        sandboxProvider?: string;
      }>
    | undefined
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
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((activity) => ({
      id: activity.id as string,
      phase: activity.phase === "start" || activity.phase === "error" ? activity.phase : "result",
      text: activity.text as string,
      timestamp: activity.timestamp as number,
      toolName: activity.toolName,
      toolCallId: activity.toolCallId,
      sandboxProvider: normalizeIdeSandboxProviderValue(activity.sandboxProvider),
    }));
}

export function formatIdeStatusEventText(
  toolName: string | undefined,
  phase: "start" | "result" | "error",
  detail?: string
): string {
  const normalizedDetail = typeof detail === "string" ? detail.trim() : "";
  if (normalizedDetail && !isGenericIdeStatusLabel(normalizedDetail)) {
    return normalizeActivityTextForPhase(normalizedDetail, phase);
  }
  const label = toolName || "Tool";
  if (phase === "start") return `${label} running...`;
  if (phase === "result") return `${label} complete`;
  return `${label} failed`;
}

export function getIdeHeaderTitle(sessionTitle: string | null, messages: IdeChatMessage[]): string {
  const normalizedSessionTitle = typeof sessionTitle === "string" ? sessionTitle.trim() : "";
  if (normalizedSessionTitle) return normalizedSessionTitle;
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage?.content?.trim()) return "IDE Chat";
  const compact = firstUserMessage.content.trim().replace(/\s+/g, " ");
  return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact;
}