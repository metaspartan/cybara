import { type AgentTransferEnvelope } from "../core/agent-transfer";
import { type AgentImage } from "../core/llm/image-blocks";
import { type SessionContextUsage, type SessionTokenUsage } from "../core/session-context";
import { type SessionPlanSnapshot } from "../core/session-plan";
import { type PendingChatMessageSnapshot } from "../core/status";
import { type ProcessActivityInfo, type ToolCallInfo } from "./chat-process-activities";

export { stripThinkingTags } from "./chat-formatting";
export {
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  provider?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  agent_id?: string;
  agent_name?: string;
  agent_type?: string;
  thinking?: string;
  tool_calls?: ToolCallInfo[];
  process_activities?: ProcessActivityInfo[];
  agent_transfers?: AgentTransferEnvelope[];
  run_id?: string;
  interrupted?: boolean;
  /** Optional image inputs (vision) attached to a user message. */
  images?: AgentImage[];
  image_context?: string;
  _pendingSteeringId?: string;
}

export interface ChatRequest {
  message: string;
  agentId?: string;
  sessionId?: string;
  modelOverride?: string;
  clientPendingId?: string;
  workspaceDir?: string;
  stream?: boolean;
  tools?: boolean;
  channel?: string;
  userId?: string;
  source?: string;
  queueMode?: "queue" | "steer";
  recordedUserMessageId?: string;
  useModelRouter?: boolean;
  awaitQueuedCompletion?: boolean;
  /** Optional image inputs (vision) for this user turn. */
  images?: AgentImage[];
}

export interface SteerPendingChatMessageOptions {
  processActivities?: unknown;
}

export interface ChatResponse {
  sessionId: string;
  message: ChatMessage;
  workspaceDir?: string | null;
  contextUsage?: SessionContextUsage;
  tokenUsage?: SessionTokenUsage;
  queued?: boolean;
  interrupted?: boolean;
  stopped?: boolean;
  pendingMessage?: PendingChatMessageSnapshot;
  pendingMessages?: PendingChatMessageSnapshot[];
  plan?: SessionPlanSnapshot | null;
  agent?: {
    id: string;
    name: string;
  };
  thinking?: string;
  tool_calls?: ToolCallInfo[];
}
