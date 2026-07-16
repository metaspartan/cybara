export interface ToolHandler {
  (args: Record<string, unknown>, context?: ToolContext): Promise<unknown>;
}

export interface ToolContext {
  agentId: string;
  sessionId?: string;
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
  suppressStreaming?: boolean;
  denyWritePrefixes?: string[];
  confineToWorkspace?: boolean;
  consumeSteeringMessages?: () => Array<{ id: string; content: string; createdAt: number }>;
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
