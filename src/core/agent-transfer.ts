import type { AgentToolCallResult } from "./agent-internals";
import type { AgentMessage } from "./agent";

export const AGENT_TRANSFER_PROTOCOL = "cybara-agent-transfer-v1";

export const AGENT_TRANSFER_CONTEXT_MODES = ["full", "recent", "summary"] as const;

export type AgentTransferContextMode = (typeof AGENT_TRANSFER_CONTEXT_MODES)[number];

export interface AgentTransferEnvelope {
  protocol: typeof AGENT_TRANSFER_PROTOCOL;
  status: "accepted";
  sessionId: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  reason: string;
  contextMode: AgentTransferContextMode;
  contextSummary?: string;
  requestedAt: string;
}

interface AgentTransferEnvelopeInput {
  sessionId: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  reason: string;
  contextMode: AgentTransferContextMode;
  contextSummary?: string;
  requestedAt?: string;
}

export interface AgentTransferInFlightContext {
  response?: string;
  toolCalls?: AgentToolCallResult[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeAgentTransferContextMode(value: unknown): AgentTransferContextMode {
  return AGENT_TRANSFER_CONTEXT_MODES.includes(value as AgentTransferContextMode)
    ? (value as AgentTransferContextMode)
    : "full";
}

export function createAgentTransferEnvelope(
  input: AgentTransferEnvelopeInput
): AgentTransferEnvelope {
  return {
    protocol: AGENT_TRANSFER_PROTOCOL,
    status: "accepted",
    sessionId: input.sessionId,
    fromAgentId: input.fromAgentId,
    fromAgentName: input.fromAgentName,
    toAgentId: input.toAgentId,
    toAgentName: input.toAgentName,
    reason: input.reason,
    contextMode: input.contextMode,
    ...(input.contextSummary ? { contextSummary: input.contextSummary } : {}),
    requestedAt: input.requestedAt || new Date().toISOString(),
  };
}

export function parseAgentTransferEnvelope(value: unknown): AgentTransferEnvelope | undefined {
  if (
    !isRecord(value) ||
    value.protocol !== AGENT_TRANSFER_PROTOCOL ||
    value.status !== "accepted"
  ) {
    return undefined;
  }
  const sessionId = readString(value, "sessionId");
  const fromAgentId = readString(value, "fromAgentId");
  const fromAgentName = readString(value, "fromAgentName");
  const toAgentId = readString(value, "toAgentId");
  const toAgentName = readString(value, "toAgentName");
  const reason = readString(value, "reason");
  const requestedAt = readString(value, "requestedAt");
  if (
    !sessionId ||
    !fromAgentId ||
    !fromAgentName ||
    !toAgentId ||
    !toAgentName ||
    !reason ||
    !requestedAt
  ) {
    return undefined;
  }
  return {
    protocol: AGENT_TRANSFER_PROTOCOL,
    status: "accepted",
    sessionId,
    fromAgentId,
    fromAgentName,
    toAgentId,
    toAgentName,
    reason,
    contextMode: normalizeAgentTransferContextMode(value.contextMode),
    ...(readString(value, "contextSummary")
      ? { contextSummary: readString(value, "contextSummary") }
      : {}),
    requestedAt,
  };
}

export function findAgentTransferEnvelope(
  toolCalls: AgentToolCallResult[] | undefined
): AgentTransferEnvelope | undefined {
  if (!toolCalls) return undefined;
  for (const toolCall of toolCalls) {
    if (toolCall.name !== "sessions_transfer") continue;
    const transfer = parseAgentTransferEnvelope(toolCall.result);
    if (transfer) return transfer;
  }
  return undefined;
}

export function hasAgentTransferEnvelope(toolCalls: AgentToolCallResult[]): boolean {
  return findAgentTransferEnvelope(toolCalls) !== undefined;
}

function transferContextInstruction(transfer: AgentTransferEnvelope): string {
  return [
    `The active chat was transferred from ${transfer.fromAgentName} to you.`,
    `Reason: ${transfer.reason}`,
    transfer.contextSummary ? `Shared state: ${transfer.contextSummary}` : "",
    "Continue the current user request directly. Do not announce or repeat the handoff unless it materially helps the answer.",
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeTransferValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildInFlightContext(context?: AgentTransferInFlightContext): string | undefined {
  if (!context) return undefined;
  const entries: string[] = [];
  for (const toolCall of context.toolCalls || []) {
    if (toolCall.name === "sessions_transfer") continue;
    const result = serializeTransferValue(toolCall.result).slice(0, 4_000);
    entries.push(`${toolCall.name}: ${result}`);
  }
  const response = context.response?.trim();
  if (response) entries.push(`Source response: ${response.slice(0, 8_000)}`);
  if (entries.length === 0) return undefined;
  return `Work completed during the current turn before transfer:\n${entries.join("\n")}`.slice(
    0,
    16_000
  );
}

export function buildAgentTransferMessages(
  messages: AgentMessage[],
  transfer: AgentTransferEnvelope,
  inFlightContext?: AgentTransferInFlightContext
): AgentMessage[] {
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversationMessages = messages.filter((message) => message.role !== "system");
  const selectedConversation =
    transfer.contextMode === "summary"
      ? conversationMessages.slice(-1)
      : transfer.contextMode === "recent"
        ? conversationMessages.slice(-12)
        : conversationMessages;
  const currentTurnContext = buildInFlightContext(inFlightContext);
  return [
    ...systemMessages,
    { role: "system", content: transferContextInstruction(transfer) },
    ...(currentTurnContext ? [{ role: "system" as const, content: currentTurnContext }] : []),
    ...selectedConversation,
  ];
}
