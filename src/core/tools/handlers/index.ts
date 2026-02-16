// Tool handler exports
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

// Re-export from main tools index
export { getToolSchemasForLLM, toolSchemas } from "../index";

// Tool execution dispatcher
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
import {
  handleLSPDiagnostics,
  handleLSPDefinition,
  handleLSPReferences,
  handleLSPHover,
  handleLSPLanguages,
} from "./lsp";
import { trackToolCall } from "../../metrics";
import { logToolExecution } from "../../logging";
import type { ToolContext } from "../index";

const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  // File tools
  read: handleRead,
  write: handleWrite,
  edit: handleEdit,
  file_search: handleFileSearch,
  grep: handleGrep,
  apply_patch: handleApplyPatch,

  // Process tools
  exec: handleExec,
  process: handleProcess,
  git: handleGit,
  mactop: async (args: Record<string, unknown>) => {
    const seconds = (args.seconds as number) || 3;
    const count = Math.min(seconds, 10); // mactop count

    // Try to run mactop if available
    try {
      // Ensure /usr/sbin is in PATH for sysctl access
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
    } catch (e) {
      // Fallback to system stats
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

  // Browser tools (OpenClaw pattern: use browser({ action: 'open', url }))
  browser: handleBrowser,
  web_fetch: handleWebFetch,
  web_search: handleWebSearch,

  // Memory tools
  memory_search: handleMemorySearch,
  memory_get: handleMemoryGet,
  memory_save: handleMemorySave,
  memory_save_durable: handleMemorySaveDurable,
  memory_context: handleMemoryContext,
  heartbeat_state: handleHeartbeatState,

  // Session tools
  sessions_spawn: handleSessionsSpawn,
  sessions_send: handleSessionsSend,
  sessions_history: handleSessionsHistory,
  sessions_list: handleSessionsList,
  session_status: handleSessionStatus,

  // Agent tools
  agents_list: handleAgentsList,

  // Channel tools
  message: handleMessage,
  canvas: handleCanvas,
  nodes: handleNodes,

  // Media tools
  image: handleImage,
  tts: handleTTS,

  // Scheduling tools
  cron: handleCron,
  gateway: handleGateway,

  // Skill tools
  summarization: handleSummarization,
  video_frames: handleVideoFrames,
  weather: handleWeather,

  // Utility tools
  clipboard: handleClipboard,
  http: handleHttp,
  data: handleData,
  env: handleEnv,

  // LSP tools (bundled TypeScript diagnostics)
  diagnostics: handleLSPDiagnostics,
  definition: handleLSPDefinition,
  references: handleLSPReferences,
  hover: handleLSPHover,
  languages: handleLSPLanguages,
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const handler = toolHandlers[name];

  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const startTime = Date.now();
  const argsPreview = JSON.stringify(args).slice(0, 200);

  try {
    console.log(`[Tool] Executing ${name} with args:`, argsPreview);
    const result = await handler(args);
    const duration = Date.now() - startTime;
    console.log(`[Tool] ${name} completed successfully in ${duration}ms`);

    // Track tool call in metrics
    await trackToolCall(name, duration, true);

    // Log to database for UI visibility
    await logToolExecution(name, "success", duration, {
      sessionId: context?.sessionId,
      agentId: context?.agentId,
      argsPreview,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Tool] ${name} error:`, error);

    // Track tool error in metrics
    await trackToolCall(name, duration, false);

    // Log error to database
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

// Register a new tool handler dynamically
export function registerToolHandler(
  name: string,
  handler: (args: Record<string, unknown>) => Promise<unknown>
): void {
  toolHandlers[name] = handler;
}

// Get tool handler for direct access
export function getToolHandler(
  name: string
): ((args: Record<string, unknown>) => Promise<unknown>) | undefined {
  return toolHandlers[name];
}
