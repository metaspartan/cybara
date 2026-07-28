export interface ToolHandler {
  (args: Record<string, unknown>, context?: ToolContext): Promise<unknown>;
}

export interface ToolExecutionRecord {
  order: number;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

export interface ToolExecutionState {
  nextToolCallOrder: number;
  toolCallsStarted: number;
  toolCalls: ToolExecutionRecord[];
}

export interface ToolContext {
  agentId: string;
  sessionId?: string;
  routerRouteId?: string;
  workspaceDir?: string;
  channel?: string;
  userId?: string;
  permissions?: string[];
  enforcePermissions?: boolean;
  allowDangerousTools?: boolean;
  requireToolUse?: boolean;
  requiredToolName?: string;
  allowedToolNames?: string[];
  allowDynamicTools?: boolean;
  abortSignal?: AbortSignal;
  modelParamsOverride?: Record<string, unknown>;
  maxOutputTokens?: number;
  suppressStreaming?: boolean;
  denyWritePrefixes?: string[];
  confineToWorkspace?: boolean;
  consumeSteeringMessages?: () => Array<{ id: string; content: string; createdAt: number }>;
  executionState?: ToolExecutionState;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler?: ToolHandler;
  permissions?: string[];
  category:
    | "core"
    | "file"
    | "process"
    | "browser"
    | "memory"
    | "channel"
    | "connector"
    | "media"
    | "skill"
    | "lsp"
    | "planning"
    | "discovery"
    | "orchestration";
}
