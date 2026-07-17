import { formatTUIAgentLabel } from "./agent-label";
import type { TUIActivityItem, TUIToolCallItem } from "./activity";
import type { TUIFetchAPI } from "./components/chat";
import type {
  AgentTransferItem,
  ChatMessage,
  PendingMessage,
} from "./components/interactive-chat-view";

export interface AgentSummary {
  id?: string;
  name?: string;
  model?: string;
  provider_id?: string;
  providerId?: string;
  status?: string;
  reasoning_effort?: string | null;
  tool_profile?: string;
  config?: unknown;
}

export interface RouterStatus {
  enabled?: boolean;
  strategy?: string;
}

export interface ControlPlaneState {
  agents: AgentSummary[];
  approvalMode: string;
  followUpBehaviorEnabled: boolean;
  routerStatus: RouterStatus | null;
}

export interface InteractiveChatProps {
  apiBase: string;
  apiKey?: string | null;
  gatewayPassword?: string | null;
  fetchAPI: TUIFetchAPI;
  initialAgentId?: string;
  initialWorkspaceDir?: string;
  sessionId?: string;
  title?: string;
  modelLine?: string;
  onExit: () => void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function messageTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(
    value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`
  );
  return Number.isFinite(parsed) ? parsed : undefined;
}

function activitiesFrom(value: unknown): TUIActivityItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (isRecord(item) ? [item as TUIActivityItem] : []));
}

function agentTransfersFrom(value: unknown): AgentTransferItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const fromAgentId = typeof item.fromAgentId === "string" ? item.fromAgentId : "";
    const fromAgentName = typeof item.fromAgentName === "string" ? item.fromAgentName : "";
    const toAgentId = typeof item.toAgentId === "string" ? item.toAgentId : "";
    const toAgentName = typeof item.toAgentName === "string" ? item.toAgentName : "";
    const reason = typeof item.reason === "string" ? item.reason : "";
    if (!fromAgentId || !fromAgentName || !toAgentId || !toAgentName || !reason) return [];
    return [
      {
        fromAgentId,
        fromAgentName,
        toAgentId,
        toAgentName,
        reason,
        requestedAt: typeof item.requestedAt === "string" ? item.requestedAt : undefined,
      },
    ];
  });
}

function toolCallsFrom(value: unknown): TUIToolCallItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (isRecord(item) ? [item as TUIToolCallItem] : []));
}

export function pendingFrom(value: unknown): PendingMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.content !== "string") {
      return [];
    }
    return [item as unknown as PendingMessage];
  });
}

export function agentsFrom(value: unknown): AgentSummary[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.agents)
      ? value.agents
      : [];
  return raw.flatMap((item) => (isRecord(item) ? [item as AgentSummary] : []));
}

export function agentLine(agent: AgentSummary): string {
  return formatTUIAgentLabel(agent);
}

export function agentConfig(agent: AgentSummary | undefined): Record<string, unknown> {
  if (!agent) return {};
  if (isRecord(agent.config)) return agent.config;
  if (typeof agent.config !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(agent.config);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function agentReasoningEffort(agent: AgentSummary | undefined): string {
  if (!agent) return "default";
  if (typeof agent.reasoning_effort === "string" && agent.reasoning_effort.trim()) {
    return agent.reasoning_effort.trim();
  }
  const config = agentConfig(agent);
  const params = isRecord(config.model_params)
    ? config.model_params
    : isRecord(config.modelParams)
      ? config.modelParams
      : null;
  const value = params?.reasoning_effort ?? params?.reasoningEffort;
  return typeof value === "string" && value.trim() ? value.trim() : "default";
}

export function agentToolProfile(agent: AgentSummary | undefined): string {
  if (typeof agent?.tool_profile === "string" && agent.tool_profile.trim()) {
    return agent.tool_profile.trim();
  }
  const value = agentConfig(agent).tool_profile;
  return typeof value === "string" && value.trim() ? value.trim() : "full";
}

export function compact(value: string, max = 52): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function messagesFromResponse(value: unknown): ChatMessage[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : isRecord(value) && Array.isArray(value.messagesList)
        ? value.messagesList
        : [];
  const out: ChatMessage[] = [];
  let latestUserTimestamp: number | undefined;
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const role = item.role;
    const content = contentText(item.content);
    const processActivities = activitiesFrom(item.process_activities);
    const toolCalls = toolCallsFrom(item.tool_calls);
    const agentTransfers = agentTransfersFrom(item.agent_transfers);
    const hasAssistantActivity =
      role === "assistant" &&
      (processActivities.length > 0 || toolCalls.length > 0 || agentTransfers.length > 0);
    if (
      (role === "user" || role === "assistant" || role === "system") &&
      (content || hasAssistantActivity)
    ) {
      const timestamp = messageTimestamp(item.timestamp ?? item.created_at ?? item.createdAt);
      if (role === "user") latestUserTimestamp = timestamp;
      out.push({
        role,
        content,
        timestamp,
        turnStartedAt: role === "assistant" ? latestUserTimestamp : undefined,
        process_activities: processActivities,
        tool_calls: toolCalls,
        agent_transfers: agentTransfers,
      });
    }
  }
  return out;
}

export function isTransientRuntimeCommand(input: string): boolean {
  return /^\/(?:goal|loop)(?:\s|$)/i.test(input.trim());
}

export function resolvePendingId(
  raw: string | undefined,
  pending: PendingMessage[]
): string | null {
  if (!raw) return null;
  if (raw.startsWith("#")) {
    const sequence = Number(raw.slice(1));
    return pending.find((message) => message.sequence === sequence)?.id || null;
  }
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0) {
    return pending.find((message) => message.sequence === numeric)?.id || null;
  }
  return raw;
}

export function resolvePendingIds(raw: string[], pending: PendingMessage[]): string[] {
  return raw.flatMap((value) => {
    const id = resolvePendingId(value, pending);
    return id ? [id] : [];
  });
}

export function insertAt(value: string, cursor: number, insert: string): [string, number] {
  return [value.slice(0, cursor) + insert + value.slice(cursor), cursor + insert.length];
}

export function deleteBefore(value: string, cursor: number): [string, number] {
  if (cursor <= 0) return [value, cursor];
  return [value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1];
}

export function deleteAt(value: string, cursor: number): string {
  if (cursor >= value.length) return value;
  return value.slice(0, cursor) + value.slice(cursor + 1);
}

export function previousWordCursor(value: string, cursor: number): number {
  const before = value.slice(0, Math.max(0, cursor));
  const withoutTrailingSpace = before.replace(/\s+$/, "");
  const boundary = withoutTrailingSpace.search(/\S+$/);
  return boundary < 0 ? 0 : boundary;
}

export function nextWordCursor(value: string, cursor: number): number {
  const after = value.slice(Math.max(0, cursor));
  const match = after.match(/^\s*\S+\s*/);
  return Math.min(value.length, cursor + (match?.[0].length ?? after.length));
}

export function deletePreviousWord(value: string, cursor: number): [string, number] {
  const start = previousWordCursor(value, cursor);
  return [value.slice(0, start) + value.slice(cursor), start];
}

export async function fetchControlPlaneState(
  fetchAPI: TUIFetchAPI,
  fallbackApprovalMode: string
): Promise<ControlPlaneState> {
  const [agentResponse, configResponse, routerResponse] = await Promise.all([
    fetchAPI<unknown>("/api/agents/summary"),
    fetchAPI<unknown>("/api/config"),
    fetchAPI<unknown>("/api/router/status"),
  ]);
  return {
    agents: agentsFrom(agentResponse),
    approvalMode:
      isRecord(configResponse) && typeof configResponse.tool_approval_mode === "string"
        ? configResponse.tool_approval_mode
        : fallbackApprovalMode,
    followUpBehaviorEnabled:
      !isRecord(configResponse) || configResponse.follow_up_behavior_enabled !== false,
    routerStatus: isRecord(routerResponse) ? (routerResponse as RouterStatus) : null,
  };
}
