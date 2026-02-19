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
import { handleEnv } from "./env";
import { handleWebSearch } from "./web-search";
import { handleWallet } from "./wallet";
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
import {
  checkToolPermissions,
  getToolRequiredPermissions,
  isDangerousTool,
  type ToolContext,
} from "../index";

export * from "./file";
export * from "./process";
export * from "./browser";
export * from "./memory";
export * from "./channel";
export * from "./skill";
export * from "./clipboard";
export * from "./http";
export * from "./data";
export * from "./env";
export * from "./web-search";
export * from "./wallet";

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
  env: handleEnv,

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

  const startTime = Date.now();
  const argsPreview = JSON.stringify(args).slice(0, 200);

  try {
    console.log(`[Tool] Executing ${name} with args:`, argsPreview);
    const result = await handler(args, context);
    const duration = Date.now() - startTime;
    console.log(`[Tool] ${name} completed successfully in ${duration}ms`);

    await trackToolCall(name, duration, true);

    await logToolExecution(name, "success", duration, {
      sessionId: context?.sessionId,
      agentId: context?.agentId,
      argsPreview,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Tool] ${name} error:`, error);

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
