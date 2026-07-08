import { createLogger } from "./logger";
import {
  listMobilePushTargets,
  recordMobilePushSendResult,
  type MobileDeviceView,
} from "./mobile-devices";
import type { StatusPayload, TaskEventPayload } from "./status";

const log = createLogger("MobilePush");
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const COMPLETION_DEDUPE_MS = 15_000;

const recentCompletionPushes = new Map<string, number>();

export interface MobilePushMessage {
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

export interface MobilePushSendSummary {
  attempted: number;
  sent: number;
  skipped: boolean;
  errors: string[];
}

function compactPushBody(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "idle") return fallback;
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

function ticketSucceeded(ticket: unknown): boolean {
  return (
    Boolean(ticket) &&
    typeof ticket === "object" &&
    (ticket as Record<string, unknown>).status === "ok"
  );
}

function ticketError(ticket: unknown): string {
  if (!ticket || typeof ticket !== "object") return "Push delivery failed";
  const record = ticket as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : "";
  const details = record.details && typeof record.details === "object" ? record.details : {};
  const detailError = (details as Record<string, unknown>).error;
  const errorMessage = typeof detailError === "string" ? detailError : "";
  return message || errorMessage || "Push delivery failed";
}

export async function sendMobilePushNotification(
  message: MobilePushMessage,
  options: { device?: MobileDeviceView; endpoint?: string } = {}
): Promise<MobilePushSendSummary> {
  const targets = options.device
    ? listMobilePushTargets().filter((target) => target.id === options.device?.id)
    : listMobilePushTargets();
  if (targets.length === 0) {
    return { attempted: 0, sent: 0, skipped: true, errors: [] };
  }

  const payloads = targets.map((target) => ({
    to: target.token,
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    sound: "default",
    priority: "default",
  }));

  try {
    const response = await fetch(options.endpoint || EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloads.length === 1 ? payloads[0] : payloads),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const error = `Expo push returned HTTP ${response.status}`;
      for (const target of targets)
        recordMobilePushSendResult(target.id, { success: false, error });
      return { attempted: targets.length, sent: 0, skipped: false, errors: [error] };
    }

    const parsed = (await response.json().catch(() => null)) as unknown;
    const data =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).data : null;
    const tickets = Array.isArray(data) ? data : data ? [data] : [];
    let sent = 0;
    const errors: string[] = [];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const ticket = tickets[index] ?? tickets[0];
      if (ticketSucceeded(ticket)) {
        sent += 1;
        recordMobilePushSendResult(target.id, { success: true });
      } else {
        const error = ticketError(ticket);
        errors.push(error);
        recordMobilePushSendResult(target.id, { success: false, error });
      }
    }
    return { attempted: targets.length, sent, skipped: false, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("Mobile push delivery failed", { error: message });
    for (const target of targets) {
      recordMobilePushSendResult(target.id, { success: false, error: message });
    }
    return { attempted: targets.length, sent: 0, skipped: false, errors: [message] };
  }
}

export function notifyMobilePushForStatus(status: StatusPayload): void {
  if (!status.sessionId || status.status !== "idle") return;
  const now = Date.now();
  const previous = recentCompletionPushes.get(status.sessionId) ?? 0;
  if (now - previous < COMPLETION_DEDUPE_MS) return;
  recentCompletionPushes.set(status.sessionId, now);
  void sendMobilePushNotification({
    title: "Cybara finished",
    body: compactPushBody(status.detail, "Chat response is ready."),
    data: { type: "chat_completed", sessionId: status.sessionId, agentId: status.agentId },
  });
}

export function notifyMobilePushForTask(event: TaskEventPayload): void {
  void sendMobilePushNotification({
    title: event.status === "completed" ? "Cybara task completed" : "Cybara task failed",
    body: compactPushBody(event.resultPreview || event.error || event.taskName, event.taskName),
    data: {
      type: event.status === "completed" ? "task_completed" : "task_failed",
      taskId: event.taskId,
      sessionId: event.sessionId,
      status: event.status,
    },
  });
}

export function resetMobilePushNotificationStateForTests(): void {
  recentCompletionPushes.clear();
}
