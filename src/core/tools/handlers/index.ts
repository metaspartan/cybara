import {
  handleRead,
  handleWrite,
  handleEdit,
  handleFileSearch,
  handleGrep,
  handleApplyPatch,
} from "./file";
import { handleExec, handleProcess, handleGit } from "./process";
import { handleBrowser, handleWebFetch } from "./browser";
import {
  handleMemorySearch,
  handleSessionSearch,
  handleMemoryGet,
  handleMemorySave,
  handleMemorySaveDurable,
  handleMemoryContext,
  handleHeartbeatState,
} from "./memory";
import {
  handleSessionsSpawn,
  handleSessionsWait,
  handleSessionsSend,
  handleSessionsHistory,
  handleSessionsList,
  handleSessionStatus,
  handleAgentsList,
  handleMessage,
  handleCanvas,
  handleNodes,
  handleImage,
  handleTTS,
  handleCron,
  handleGateway,
} from "./channel";
import { handleSkillSave, handleSummarization, handleVideoFrames, handleWeather } from "./skill";
import { handleHomeAssistant } from "./home-assistant";
import { handleMixtureOfAgents } from "./mixture-of-agents";
import { handleTodo } from "./todo";
import { handleClarify } from "./clarify";
import { handleToolSearch, handleToolDescribe, handleToolCall } from "./tool-discovery";
import { handleExecuteCode } from "./execute-code";
import { handleImageGenerate, handleVideoGenerate, handleMusicGenerate } from "./media-generation";
import {
  COMPUTER_USE_ACTION_TOOL_ALIASES,
  COMPUTER_USE_COMPAT_TOOL_ALIASES,
  handleComputerUse,
  normalizeComputerUseActionArgs,
  normalizeComputerUseCompatToolArgs,
} from "../../computer-use";
import {
  handleKanbanShow,
  handleKanbanList,
  handleKanbanComplete,
  handleKanbanBlock,
  handleKanbanHeartbeat,
  handleKanbanComment,
  handleKanbanCreate,
  handleKanbanUnblock,
  handleKanbanLink,
} from "./kanban";
import { handleClipboard } from "./clipboard";
import { handleHttp } from "./http";
import { handleData } from "./data";
import { handleCalc, handleConvert } from "./calc";
import { handleEnv } from "./env";
import { handleWebSearch } from "./web-search";
import { handleXSearch } from "./x-search";
import { handleTranscribe } from "./transcribe";
import { handleArtifacts } from "./artifacts";
import { handlePhoneCall, handleVoiceCall } from "./phone";
import { handleWallet } from "./wallet";
import { handleWorkspaceIndexSearch } from "./workspace-index";
import {
  collectMacSystemFallback,
  hasMactopBinary,
  normalizeMactopSampleCount,
  runMactopJsonSamples,
} from "../mactop";
import {
  handleLSPDiagnostics,
  handleLSPDefinition,
  handleLSPReferences,
  handleLSPHover,
  handleLSPLanguages,
} from "./lsp";
import { handleOcr } from "../../skills/ocr";
import { handlePdf } from "../../skills/pdf";
import { trackMetric, trackToolCall } from "../../metrics";
import { logToolExecution } from "../../logging";
import { config } from "../../config";
import { coerceToolArguments } from "../../tool-argument-coercion";
import {
  isToolPolicyBlockedMessage,
  sanitizeToolErrorMessage,
} from "../../tool-result-classification";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { createHash } from "crypto";
import {
  checkToolPermissions,
  getToolRequiredPermissions,
  isDangerousTool,
  handleTelegramMedia,
  toolSchemas as toolSchemaRegistry,
  type ToolContext,
} from "../index";
import { createLogger } from "../../logger";
import { requestToolApproval } from "../../tool-approval";

const log = createLogger("Tools");

export * from "./file";
export * from "./process";
export * from "./browser";
export * from "./memory";
export * from "./channel";
export * from "./skill";
export * from "./clipboard";
export * from "./http";
export * from "./data";
export * from "./calc";
export * from "./env";
export * from "./web-search";
export * from "./x-search";
export * from "./transcribe";
export * from "./artifacts";
export * from "./workspace-index";
export * from "./phone";

export {
  checkToolPermissions,
  getToolRequiredPermissions,
  getToolSchemasForLLM,
  toolSchemas,
} from "../index";

const toolHandlers: Record<
  string,
  (args: Record<string, unknown>, context?: ToolContext) => Promise<unknown>
> = {
  read: handleRead,
  write: handleWrite,
  edit: handleEdit,
  file_search: handleFileSearch,
  grep: handleGrep,
  workspace_index_search: handleWorkspaceIndexSearch,
  apply_patch: handleApplyPatch,

  exec: handleExec,
  process: handleProcess,
  git: handleGit,
  mactop: async (args: Record<string, unknown>) => {
    const count = normalizeMactopSampleCount(args.seconds, 3, 10);

    try {
      if (process.platform !== "darwin") {
        return {
          error: "mactop is only available on macOS with Apple Silicon.",
          installHint: "This tool requires macOS.",
        };
      }

      if (hasMactopBinary()) {
        const result = runMactopJsonSamples(count);
        if (result.exitCode === 0 && result.stdout.trim()) {
          return {
            source: "mactop",
            output: result.stdout,
            count,
            format: "json",
          };
        }

        return {
          ...collectMacSystemFallback(),
          count,
          note: result.stderr.trim() || "mactop returned no metrics - check installation",
        };
      }

      return {
        ...collectMacSystemFallback(),
        count,
        note: "mactop not found. Install mactop to enable Apple Silicon hardware metrics.",
        installHint: "brew install mactop",
      };
    } catch {
      try {
        return {
          ...collectMacSystemFallback(),
          count,
          note: "mactop returned error - check installation",
        };
      } catch {
        return {
          error: "Could not retrieve hardware metrics",
        };
      }
    }
  },

  browser: handleBrowser,
  web_fetch: handleWebFetch,
  web_search: handleWebSearch,
  x_search: handleXSearch,
  transcribe: handleTranscribe,
  wallet: handleWallet,
  artifacts: handleArtifacts,

  memory_search: handleMemorySearch,
  session_search: handleSessionSearch,
  memory_get: handleMemoryGet,
  memory_save: handleMemorySave,
  memory_save_durable: handleMemorySaveDurable,
  memory_context: handleMemoryContext,
  heartbeat_state: handleHeartbeatState,

  sessions_spawn: handleSessionsSpawn,
  sessions_wait: handleSessionsWait,
  sessions_send: handleSessionsSend,
  sessions_history: handleSessionsHistory,
  sessions_list: handleSessionsList,
  session_status: handleSessionStatus,

  agents_list: handleAgentsList,

  message: handleMessage,
  canvas: handleCanvas,
  nodes: handleNodes,

  image: handleImage,
  tts: handleTTS,

  cron: handleCron,
  gateway: handleGateway,

  skill_save: handleSkillSave,
  summarization: handleSummarization,
  video_frames: handleVideoFrames,
  weather: handleWeather,
  home_assistant: handleHomeAssistant,
  mixture_of_agents: handleMixtureOfAgents,

  todo: handleTodo,
  clarify: handleClarify,

  tool_search: handleToolSearch,
  tool_describe: handleToolDescribe,
  tool_call: handleToolCall,

  execute_code: handleExecuteCode,

  image_generate: handleImageGenerate,
  video_generate: handleVideoGenerate,
  music_generate: handleMusicGenerate,

  computer_use: handleComputerUse,

  kanban_show: handleKanbanShow,
  kanban_list: handleKanbanList,
  kanban_complete: handleKanbanComplete,
  kanban_block: handleKanbanBlock,
  kanban_heartbeat: handleKanbanHeartbeat,
  kanban_comment: handleKanbanComment,
  kanban_create: handleKanbanCreate,
  kanban_unblock: handleKanbanUnblock,
  kanban_link: handleKanbanLink,

  clipboard: handleClipboard,
  http: handleHttp,
  data: handleData,
  calc: handleCalc,
  convert: handleConvert,
  env: handleEnv,

  phone: handlePhoneCall,
  voice_call: handleVoiceCall,

  // Keys MUST match the tool schema names in tools/index.ts (lsp_*), otherwise
  // executeTool throws "Unknown tool" for tools the LLM is advertised.
  lsp_diagnostics: handleLSPDiagnostics,
  lsp_definition: handleLSPDefinition,
  lsp_references: handleLSPReferences,
  lsp_hover: handleLSPHover,
  lsp_languages: handleLSPLanguages,
  ocr: handleOcr,
  pdf: handlePdf,
  telegram_media: handleTelegramMedia,
};

for (const action of COMPUTER_USE_ACTION_TOOL_ALIASES) {
  toolHandlers[action] = async (args: Record<string, unknown>) =>
    handleComputerUse(normalizeComputerUseActionArgs(action, args));
}
for (const [toolName, action] of Object.entries(COMPUTER_USE_COMPAT_TOOL_ALIASES)) {
  toolHandlers[toolName] = async (args: Record<string, unknown>) =>
    handleComputerUse(normalizeComputerUseCompatToolArgs(action, args));
}

function getDangerousToolPolicy(): { enabled: boolean; mode: "audit" | "block" } {
  const policy = config.getDangerousToolPolicy();
  return {
    enabled: policy.enabled === true,
    mode: policy.mode === "block" ? "block" : "audit",
  };
}

function getToolApprovalMode(): "always_allow" | "ask" {
  return config.getToolApprovalMode();
}

function normalizeWorkspaceDirectory(workspaceDir?: string): string | undefined {
  if (typeof workspaceDir !== "string") return undefined;
  const trimmed = workspaceDir.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|\/|\\)/, homedir()));
  }
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(process.cwd(), trimmed);
}

function resolveWorkspacePath(path: string, workspaceDir: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|\/|\\)/, homedir()));
  }
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(workspaceDir, trimmed);
}

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|cookie|private[_-]?key|mnemonic)/i;

function redactStringValue(input: string): string {
  let output = input;
  output = output.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
  output = output.replace(
    /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\s*[:=]\s*)([^\s,;]+)/gi,
    "$1[REDACTED]"
  );
  if (output.length > 240) {
    const hash = createHash("sha256").update(output).digest("hex").slice(0, 12);
    return `${output.slice(0, 220)}...[truncated sha256:${hash}]`;
  }
  return output;
}

function sanitizeArgs(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[MaxDepth]";
  if (value == null) return value;
  if (typeof value === "string") return redactStringValue(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeArgs(item, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizeArgs(raw, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

function createArgsPreview(args: Record<string, unknown>): string {
  const sanitized = sanitizeArgs(args);
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= 2000) return serialized;
  const hash = createHash("sha256").update(serialized).digest("hex").slice(0, 12);
  return `${serialized.slice(0, 1800)}...[truncated sha256:${hash}]`;
}

export function createToolArgsPreviewForLog(args: Record<string, unknown>): string {
  return createArgsPreview(args);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function applyWorkspaceDefaults(
  toolName: string,
  args: Record<string, unknown>,
  context?: ToolContext
): Record<string, unknown> {
  const normalizedWorkspaceDir = normalizeWorkspaceDirectory(context?.workspaceDir);
  let nextArgs: Record<string, unknown> | null = null;
  const setArg = (key: string, value: unknown) => {
    if (!nextArgs) {
      nextArgs = { ...args };
    }
    nextArgs[key] = value;
  };

  if (toolName === "sessions_spawn") {
    if (!hasNonEmptyString(args._requesterSessionKey) && hasNonEmptyString(context?.sessionId)) {
      setArg("_requesterSessionKey", context?.sessionId);
    }
    if (!hasNonEmptyString(args.workspaceDir) && normalizedWorkspaceDir) {
      setArg("workspaceDir", normalizedWorkspaceDir);
    }
  }

  if (!normalizedWorkspaceDir) {
    return nextArgs || args;
  }

  if ((toolName === "exec" || toolName === "git") && !hasNonEmptyString(args.workdir)) {
    setArg("workdir", normalizedWorkspaceDir);
  }

  if (toolName === "file_search" && !hasNonEmptyString(args.cwd)) {
    setArg("cwd", normalizedWorkspaceDir);
  }

  if (toolName === "grep" && !hasNonEmptyString(args.path)) {
    setArg("path", normalizedWorkspaceDir);
  }

  if (toolName === "workspace_index_search" && !hasNonEmptyString(args.path)) {
    setArg("path", normalizedWorkspaceDir);
  }

  if (
    (toolName === "read" || toolName === "write" || toolName === "edit") &&
    hasNonEmptyString(args.path)
  ) {
    const resolvedPath = resolveWorkspacePath(args.path, normalizedWorkspaceDir);
    if (resolvedPath !== args.path) {
      setArg("path", resolvedPath);
    }
  }

  return nextArgs || args;
}

const REQUIRED_ARG_ALIASES: Record<string, Record<string, string[]>> = {
  read: { path: ["file"] },
};

function hasRequiredToolArgument(
  toolName: string,
  args: Record<string, unknown>,
  key: string
): boolean {
  const keys = [key, ...(REQUIRED_ARG_ALIASES[toolName]?.[key] || [])];
  return keys.some((candidate) => {
    const value = args?.[candidate];
    return (
      value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "")
    );
  });
}

export function getMissingRequiredToolArguments(
  name: string,
  args: Record<string, unknown>
): string[] {
  const schema = toolSchemaRegistry[name]?.input_schema as { required?: string[] } | undefined;
  if (!Array.isArray(schema?.required) || schema.required.length === 0) {
    return [];
  }
  return schema.required.filter((key) => !hasRequiredToolArgument(name, args, key));
}

export function formatMissingRequiredToolArgumentsError(name: string, missing: string[]): string {
  return `Validation error: Missing required argument${missing.length > 1 ? "s" : ""} for tool '${name}': ${missing.join(", ")}. Re-call with ${missing.length > 1 ? "these arguments" : "this argument"}.`;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  if (context?.allowedToolNames && !context.allowedToolNames.includes(name)) {
    throw new Error(`Validation error: Tool '${name}' is not enabled for this agent`);
  }
  const handler = toolHandlers[name];

  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }

  args = coerceToolArguments(name, args, toolSchemaRegistry[name]?.input_schema);

  const missing = getMissingRequiredToolArguments(name, args);
  if (missing.length > 0) {
    throw new Error(formatMissingRequiredToolArgumentsError(name, missing));
  }

  const requiredPermissions = getToolRequiredPermissions(name);
  const contextPermissions = context?.permissions || [];
  const shouldEnforcePermissions = context?.enforcePermissions === true;
  if (shouldEnforcePermissions && !checkToolPermissions(requiredPermissions, contextPermissions)) {
    const needed =
      requiredPermissions.length > 0 ? requiredPermissions.join(", ") : "no specific permission";
    throw new Error(`Validation error: Permission denied for tool '${name}' (requires ${needed})`);
  }

  const dangerousPolicy = getDangerousToolPolicy();
  const toolApprovalMode = getToolApprovalMode();
  const isDangerous = isDangerousTool(name);
  const allowDangerous = context?.allowDangerousTools === true;
  if (isDangerous && dangerousPolicy.enabled && !allowDangerous) {
    if (dangerousPolicy.mode === "block") {
      trackMetric("dangerous_tool_usage", name, 1, {
        blocked: true,
        mode: dangerousPolicy.mode,
        sessionId: context?.sessionId,
        agentId: context?.agentId,
      });
      throw new Error(
        `Validation error: Dangerous tool '${name}' blocked by policy. Disable dangerous tool policy in Settings or allow dangerous tools explicitly for this execution.`
      );
    }
    trackMetric("dangerous_tool_usage", name, 1, {
      blocked: false,
      mode: dangerousPolicy.mode,
      sessionId: context?.sessionId,
      agentId: context?.agentId,
    });
  } else if (isDangerous && allowDangerous) {
    trackMetric("dangerous_tool_usage", name, 1, {
      blocked: false,
      mode: dangerousPolicy.mode,
      override: true,
      sessionId: context?.sessionId,
      agentId: context?.agentId,
    });
  }

  if (isDangerous && toolApprovalMode === "ask" && !allowDangerous) {
    // Interactive approval: suspend the tool call and wait for user consent,
    // rather than throwing immediately. If no session context (e.g. CLI one-shot),
    // fall back to the throw.
    if (context?.sessionId) {
      const decision = await requestToolApproval({
        sessionId: context.sessionId,
        agentId: context.agentId,
        toolName: name,
        argsSummary: createArgsPreview(args).slice(0, 200),
        argsPreview: args,
      });
      if (decision === "deny") {
        trackMetric("dangerous_tool_usage", name, 1, {
          blocked: true,
          mode: dangerousPolicy.mode,
          approvalMode: toolApprovalMode,
          sessionId: context?.sessionId,
          agentId: context?.agentId,
        });
        throw new Error(`Tool '${name}' was denied by the operator.`);
      }
      // Approved — fall through to execute.
    } else {
      // No session context — can't suspend for approval, so throw the old error.
      trackMetric("dangerous_tool_usage", name, 1, {
        blocked: true,
        mode: dangerousPolicy.mode,
        approvalMode: toolApprovalMode,
        sessionId: context?.sessionId,
        agentId: context?.agentId,
      });
      throw new Error(
        `Validation error: Tool '${name}' requires approval. Set Tool Approvals to Always Allow in Settings, or run from a chat session to get an interactive prompt.`
      );
    }
  }

  const resolvedArgs = applyWorkspaceDefaults(name, args, context);
  const startTime = Date.now();
  const argsPreview = createArgsPreview(resolvedArgs);

  try {
    log.info("Executing tool", {
      name,
      argsPreview,
      sessionId: context?.sessionId,
      agentId: context?.agentId,
    });
    const result = await handler(resolvedArgs, context);
    const duration = Date.now() - startTime;
    log.info("Tool completed", {
      name,
      durationMs: duration,
      sessionId: context?.sessionId,
      agentId: context?.agentId,
    });

    await trackToolCall(name, duration, true);

    await logToolExecution(name, "success", duration, {
      sessionId: context?.sessionId,
      agentId: context?.agentId,
      argsPreview,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = sanitizeToolErrorMessage(error);
    const blocked = isToolPolicyBlockedMessage(errorMessage);
    const logContext = {
      name,
      durationMs: duration,
      sessionId: context?.sessionId,
      agentId: context?.agentId,
    };
    if (blocked) {
      log.warn("Tool execution blocked", { ...logContext, reason: errorMessage });
    } else {
      log.exception("Tool execution failed", error, logContext);
    }

    await trackToolCall(name, duration, blocked);
    if (blocked) {
      trackMetric("tool_blocked", name, 1, {
        sessionId: context?.sessionId,
        agentId: context?.agentId,
        reason: errorMessage,
      });
    }

    await logToolExecution(name, blocked ? "blocked" : "error", duration, {
      sessionId: context?.sessionId,
      agentId: context?.agentId,
      argsPreview,
      error: errorMessage,
    });

    throw error;
  }
}

export function hasTool(name: string): boolean {
  return name in toolHandlers;
}

export function getToolNames(): string[] {
  return Object.keys(toolHandlers);
}

export function registerToolHandler(
  name: string,
  handler: (args: Record<string, unknown>, context?: ToolContext) => Promise<unknown>
): void {
  toolHandlers[name] = handler;
}

export function getToolHandler(
  name: string
): ((args: Record<string, unknown>, context?: ToolContext) => Promise<unknown>) | undefined {
  return toolHandlers[name];
}
