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
  handleMemoryGet,
  handleMemorySave,
  handleMemorySaveDurable,
  handleMemoryContext,
  handleHeartbeatState,
} from "./memory";
import {
  handleSessionsSpawn,
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
import { handleSummarization, handleVideoFrames, handleWeather } from "./skill";
import { handleClipboard } from "./clipboard";
import { handleHttp } from "./http";
import { handleData } from "./data";
import { handleCalc, handleConvert } from "./calc";
import { handleEnv } from "./env";
import { handleWebSearch } from "./web-search";
import { handleArtifacts } from "./artifacts";
import { handlePhoneCall, handleVoiceCall } from "./phone";
import { handleWallet } from "./wallet";
import { handleWorkspaceIndexSearch } from "./workspace-index";
import {
  handleLSPDiagnostics,
  handleLSPDefinition,
  handleLSPReferences,
  handleLSPHover,
  handleLSPLanguages,
} from "./lsp";
import { trackMetric, trackToolCall } from "../../metrics";
import { logToolExecution } from "../../logging";
import { config } from "../../config";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { createHash } from "crypto";
import {
  checkToolPermissions,
  getToolRequiredPermissions,
  isDangerousTool,
  type ToolContext,
} from "../index";
import { createLogger } from "../../logger";

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
    const seconds = (args.seconds as number) || 3;
    const count = Math.min(seconds, 10); // mactop count

    try {
      const env = { ...process.env, PATH: "/usr/sbin:" + (process.env.PATH || "") };
      const result = Bun.spawnSync(
        [
          "sh",
          "-c",
          `mactop --headless --count ${count} --format json 2>&1 || echo "mactop error"`,
        ],
        {
          timeout: (seconds + 5) * 1000,
          env,
        }
      );
      return {
        source: "mactop",
        output: result.stdout.toString(),
        count,
        format: "json",
      };
    } catch {
      try {
        const env = { ...process.env, PATH: "/usr/sbin:" + (process.env.PATH || "") };
        const cpuInfo = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.brand_string"], { env })
          .stdout.toString()
          .trim();
        const coreCount = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.core_count"], { env })
          .stdout.toString()
          .trim();
        const memResult = Bun.spawnSync(
          ["sh", "-c", "vm_stat 2>/dev/null | head -5 || echo 'Unknown'"],
          { env }
        );
        const memory = memResult.stdout.toString().trim();

        return {
          source: "system_fallback",
          cpu: { model: cpuInfo, cores: coreCount },
          memory,
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
  wallet: handleWallet,
  artifacts: handleArtifacts,

  memory_search: handleMemorySearch,
  memory_get: handleMemoryGet,
  memory_save: handleMemorySave,
  memory_save_durable: handleMemorySaveDurable,
  memory_context: handleMemoryContext,
  heartbeat_state: handleHeartbeatState,

  sessions_spawn: handleSessionsSpawn,
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

  summarization: handleSummarization,
  video_frames: handleVideoFrames,
  weather: handleWeather,

  clipboard: handleClipboard,
  http: handleHttp,
  data: handleData,
  calc: handleCalc,
  convert: handleConvert,
  env: handleEnv,

  phone: handlePhoneCall,
  voice_call: handleVoiceCall,

  diagnostics: handleLSPDiagnostics,
  definition: handleLSPDefinition,
  references: handleLSPReferences,
  hover: handleLSPHover,
  languages: handleLSPLanguages,
};

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

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const handler = toolHandlers[name];

  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
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
    trackMetric("dangerous_tool_usage", name, 1, {
      blocked: true,
      mode: dangerousPolicy.mode,
      approvalMode: toolApprovalMode,
      sessionId: context?.sessionId,
      agentId: context?.agentId,
    });
    throw new Error(
      `Validation error: Tool '${name}' requires approval while tool approval mode is set to ask. Use /permissions allow in channels or set Tool Approvals to Always Allow in Settings, then retry.`
    );
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
    log.exception("Tool execution failed", error, {
      name,
      durationMs: duration,
      sessionId: context?.sessionId,
      agentId: context?.agentId,
    });

    await trackToolCall(name, duration, false);

    await logToolExecution(name, "error", duration, {
      sessionId: context?.sessionId,
      agentId: context?.agentId,
      argsPreview,
      error: (error as Error).message,
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
