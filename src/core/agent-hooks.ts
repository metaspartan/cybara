export interface AgentHookContext {
  agentId?: string;
  sessionId?: string;
  channel?: string;
  userId?: string;
  provider?: string;
  model?: string;
}

export interface AgentLLMRequestEvent {
  type: "llm_request";
  context: AgentHookContext;
  messages: Array<{ role: string; content: string }>;
  toolNames: string[];
}

export interface AgentLLMResponseEvent {
  type: "llm_response";
  context: AgentHookContext;
  content: string;
  toolNames: string[];
  durationMs: number;
}

export interface AgentLLMErrorEvent {
  type: "llm_error";
  context: AgentHookContext;
  error: string;
  durationMs: number;
}

export interface AgentToolBeforeEvent {
  type: "tool_before";
  context: AgentHookContext;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentToolAfterEvent {
  type: "tool_after";
  context: AgentHookContext;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentToolErrorEvent {
  type: "tool_error";
  context: AgentHookContext;
  toolName: string;
  args: Record<string, unknown>;
  error: string;
}

export interface AgentToolBlockedEvent {
  type: "tool_blocked";
  context: AgentHookContext;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
}

export interface AgentMessageReceivedEvent {
  type: "message:received";
  context: AgentHookContext;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMessageSentEvent {
  type: "message:sent";
  context: AgentHookContext;
  message: string;
  metadata?: Record<string, unknown>;
}

export type AgentHookEvent =
  | AgentLLMRequestEvent
  | AgentLLMResponseEvent
  | AgentLLMErrorEvent
  | AgentToolBeforeEvent
  | AgentToolAfterEvent
  | AgentToolErrorEvent
  | AgentToolBlockedEvent
  | AgentMessageReceivedEvent
  | AgentMessageSentEvent;

export interface AgentHookDecision {
  block?: boolean;
  reason?: string;
}

export type AgentHook = (
  event: AgentHookEvent
) => void | AgentHookDecision | Promise<void | AgentHookDecision>;

const hooks = new Map<string, AgentHook>();

function normalizeHookError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown hook error");
}

export function registerAgentHook(hook: AgentHook): { id: string; unregister: () => void } {
  const id = crypto.randomUUID();
  hooks.set(id, hook);
  return {
    id,
    unregister: () => {
      hooks.delete(id);
    },
  };
}

export function unregisterAgentHook(id: string): boolean {
  return hooks.delete(id);
}

export function listAgentHookIds(): string[] {
  return [...hooks.keys()];
}

export async function emitAgentHook(event: AgentHookEvent): Promise<AgentHookDecision | undefined> {
  let decision: AgentHookDecision | undefined;

  for (const hook of hooks.values()) {
    try {
      const result = await hook(event);
      if (event.type === "tool_before" && result && typeof result === "object" && result.block) {
        if (!decision) {
          decision = {
            block: true,
            reason:
              typeof result.reason === "string" && result.reason.trim()
                ? result.reason.trim()
                : "Tool execution blocked by hook",
          };
        }
      }
    } catch (error) {
      console.warn(`[AgentHook] Hook execution failed: ${normalizeHookError(error)}`);
    }
  }

  return decision;
}

export function resetAgentHooksForTests(): void {
  hooks.clear();
}
