import { channelManager, telegramBot } from "../channels";
import {
  COMPUTER_USE_ACTION_TOOL_ALIASES,
  COMPUTER_USE_COMPAT_TOOL_ALIASES,
  handleComputerUse,
  normalizeComputerUseActionArgs,
  normalizeComputerUseCompatToolArgs,
} from "../computer-use";
import { config } from "../config";
import { getStoredAccountConnector } from "../account-connectors/store";
import { ACCOUNT_CONNECTOR_IDS } from "../account-connectors/types";
import { getSkillExecutors } from "../skills/index";
import { handleSkillLoad } from "./handlers/skill";
import { handleArtifacts } from "./handlers/artifacts";
import { handleCanvas } from "./handlers/canvas";
import { handleClipboard } from "./handlers/clipboard";
import { handleData } from "./handlers/data";
import {
  handleAccountConnectorRead,
  handleAccountConnectorWrite,
} from "./handlers/account-connectors";
import { handleEnv } from "./handlers/env";
import { handleEdit, handleFileSearch, handleGrep, handleRead, handleWrite } from "./handlers/file";
import { handleHttp } from "./handlers/http";
import {
  handleLSPDefinition,
  handleLSPDiagnostics,
  handleLSPHover,
  handleLSPLanguages,
  handleLSPReferences,
} from "./handlers/lsp";
import {
  handleMemoryGet,
  handleMemoryList,
  handleMemorySave,
  handleMemorySearch,
  handleSessionSearch,
} from "./handlers/memory";
import { handleWorkspaceIndexSearch } from "./handlers/workspace-index";
import { handleMobileSimulator } from "./handlers/mobile-simulator";
import { toolSchemas } from "./schemas";
import type { Tool, ToolContext, ToolHandler } from "./types";

export { toolSchemas } from "./schemas";
export type { Tool, ToolContext, ToolHandler } from "./types";

const _toolHandlers = new Map<string, ToolHandler>();
export const toolHandlers = _toolHandlers;

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const rateLimits: Record<string, { count: number; resetTime: number }> = {};

const dangerousPermissionPrefixes = ["exec:", "wallet:", "message:", "gateway:", "cron:"];
const dangerousPermissions = new Set([
  "browser:control",
  "env:write",
  "telegram:media",
  "clipboard:access",
]);
const dangerousToolNames = new Set([
  "exec",
  "process",
  "git",
  "browser",
  "wallet",
  "message",
  "gateway",
  "cron",
  "env",
  "http",
  "computer_use",
  "mobile_simulator",
  "account_connector_write",
  "execute_code",
  "sandbox_run",
  "write",
  "edit",
  "apply_patch",
  // camera_snap / screen_record capture the user's camera and screen — gate
  // them behind the dangerous-tool approval flow (privacy-sensitive).
  "nodes",
]);

export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const record = rateLimits[key];

  if (!record || now > record.resetTime) {
    rateLimits[key] = { count: 1, resetTime: now + config.windowMs };
    return { allowed: true, remaining: config.maxRequests - 1, resetTime: now + config.windowMs };
  }

  if (record.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime };
  }

  record.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - record.count,
    resetTime: record.resetTime,
  };
}

export function getRateLimitStatus(key: string): { remaining: number; resetTime: number } {
  const record = rateLimits[key];
  if (!record || Date.now() > record.resetTime) {
    return { remaining: 100, resetTime: Date.now() + 60000 };
  }
  return { remaining: 100 - record.count, resetTime: record.resetTime };
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeMs: number;
}

interface CircuitState {
  state: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailureTime: number;
  successesSinceHalfOpen: number;
}

const circuitBreakers: Map<string, CircuitState> = new Map();
const defaultBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeMs: 30000,
};

export function getCircuitState(service: string): CircuitState | undefined {
  return circuitBreakers.get(service);
}

export function checkCircuit(
  service: string,
  config: CircuitBreakerConfig = defaultBreakerConfig
): { allowed: boolean; state: string } {
  const state = circuitBreakers.get(service);

  if (!state) {
    return { allowed: true, state: "closed" };
  }

  const now = Date.now();

  if (state.state === "open") {
    if (now - state.lastFailureTime >= config.recoveryTimeMs) {
      state.state = "half-open";
      state.successesSinceHalfOpen = 0;
      return { allowed: true, state: "half-open" };
    }
    return { allowed: false, state: "open" };
  }

  return { allowed: true, state: state.state };
}

export function recordCircuitSuccess(service: string): void {
  const state = circuitBreakers.get(service);
  if (state) {
    if (state.state === "half-open") {
      state.successesSinceHalfOpen++;
      if (state.successesSinceHalfOpen >= 3) {
        circuitBreakers.delete(service);
      }
    }
    state.failureCount = 0;
  }
}

export function recordCircuitFailure(
  service: string,
  config: CircuitBreakerConfig = defaultBreakerConfig
): void {
  let state = circuitBreakers.get(service);
  if (!state) {
    state = {
      state: "closed",
      failureCount: 0,
      lastFailureTime: Date.now(),
      successesSinceHalfOpen: 0,
    };
    circuitBreakers.set(service, state);
  }

  state.failureCount++;
  state.lastFailureTime = Date.now();

  if (state.failureCount >= config.failureThreshold) {
    state.state = "open";
  }
}

function createComputerUseActionAliasSchema(
  toolName: string,
  action: string
): Omit<Tool, "handler"> {
  const baseSchema = toolSchemas.computer_use.input_schema as {
    type?: string;
    properties?: Record<string, unknown>;
  };
  const { action: _action, ...properties } = baseSchema.properties || {};
  return {
    name: toolName,
    description: `Compatibility alias for computer_use with action='${action}'. Use this when a provider emits '${toolName}' as a direct computer-use tool name.`,
    category: "media",
    input_schema: {
      type: "object",
      properties,
    },
    permissions: [],
  };
}

for (const action of COMPUTER_USE_ACTION_TOOL_ALIASES) {
  toolSchemas[action] = createComputerUseActionAliasSchema(action, action);
  dangerousToolNames.add(action);
}

for (const [toolName, action] of Object.entries(COMPUTER_USE_COMPAT_TOOL_ALIASES)) {
  toolSchemas[toolName] = createComputerUseActionAliasSchema(toolName, action);
  dangerousToolNames.add(toolName);
}

export function isToolEnabledForAgent(toolName: string): boolean {
  if (toolName === "eval_save") {
    const lab = config.getLabSettings();
    return lab.enabled && lab.goldenTurnsEnabled;
  }
  if (toolName === "eval_replay") {
    return config.getLabSettings().enabled;
  }
  if (toolName === "wallet") {
    return config.get<boolean>("wallet_agent_access_enabled") === true;
  }
  if (toolName === "skill_save") {
    return isSelfImprovingSkillsEnabled();
  }
  if (toolName === "account_connector") {
    return ACCOUNT_CONNECTOR_IDS.some((id) => {
      const connector = getStoredAccountConnector(id);
      return Boolean(connector.accessToken || connector.refreshToken);
    });
  }
  if (toolName === "account_connector_write") {
    return ACCOUNT_CONNECTOR_IDS.some((id) => {
      const connector = getStoredAccountConnector(id);
      return (
        connector.access === "read_write" &&
        Boolean(connector.accessToken || connector.refreshToken)
      );
    });
  }
  return true;
}

/**
 * Self-improving skills: whether agents may create reusable skills at runtime
 * via `skill_save`. Enabled by default; operators can turn it off from any
 * client. When off, the tool is withheld and the system-prompt nudge is hidden.
 */
export function isSelfImprovingSkillsEnabled(): boolean {
  return config.get<boolean>("self_improving_skills_enabled") !== false;
}

export function getToolSchemasForLLM(): Omit<Tool, "handler">[] {
  return Object.values(toolSchemas).filter((tool) => isToolEnabledForAgent(tool.name));
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return _toolHandlers.get(name);
}

export function getToolRequiredPermissions(name: string): string[] {
  const tool = toolSchemas[name];
  if (!tool || !Array.isArray(tool.permissions)) return [];
  return tool.permissions;
}

export function isDangerousTool(name: string): boolean {
  if (dangerousToolNames.has(name)) return true;
  const permissions = getToolRequiredPermissions(name);
  return permissions.some(
    (permission) =>
      dangerousPermissions.has(permission) ||
      dangerousPermissionPrefixes.some((prefix) => permission.startsWith(prefix))
  );
}

export function getDangerousToolNames(): string[] {
  return Object.keys(toolSchemas).filter((name) => isDangerousTool(name));
}

export function checkToolPermissions(
  permissions: string[] = [],
  contextPermissions: string[] = []
): boolean {
  if (permissions.length === 0) return true;
  if (contextPermissions.includes("*")) return true;
  return permissions.every((permission) => contextPermissions.includes(permission));
}

export type ToolName = keyof typeof toolSchemas;

_toolHandlers.set("read", handleRead);
_toolHandlers.set("write", handleWrite);
_toolHandlers.set("edit", handleEdit);
_toolHandlers.set("file_search", handleFileSearch);
_toolHandlers.set("grep", handleGrep);
_toolHandlers.set("workspace_index_search", handleWorkspaceIndexSearch);
_toolHandlers.set("skill_load", handleSkillLoad);

_toolHandlers.set("memory_search", handleMemorySearch);
_toolHandlers.set("session_search", handleSessionSearch);
_toolHandlers.set("memory_get", handleMemoryGet);
_toolHandlers.set("memory_save", handleMemorySave);
_toolHandlers.set("memory_list", handleMemoryList);
_toolHandlers.set("artifacts", handleArtifacts);

_toolHandlers.set("clipboard", handleClipboard);
_toolHandlers.set("http", handleHttp);
_toolHandlers.set("data", handleData);
_toolHandlers.set("account_connector", handleAccountConnectorRead);
_toolHandlers.set("account_connector_write", handleAccountConnectorWrite);
_toolHandlers.set("env", handleEnv);

_toolHandlers.set("lsp_diagnostics", handleLSPDiagnostics);
_toolHandlers.set("lsp_definition", handleLSPDefinition);
_toolHandlers.set("lsp_references", handleLSPReferences);
_toolHandlers.set("lsp_hover", handleLSPHover);
_toolHandlers.set("lsp_languages", handleLSPLanguages);
_toolHandlers.set("canvas", handleCanvas);
_toolHandlers.set("computer_use", handleComputerUse);
_toolHandlers.set("mobile_simulator", handleMobileSimulator);
for (const action of COMPUTER_USE_ACTION_TOOL_ALIASES) {
  _toolHandlers.set(action, async (args, context) =>
    handleComputerUse(normalizeComputerUseActionArgs(action, args), context)
  );
}
for (const [toolName, action] of Object.entries(COMPUTER_USE_COMPAT_TOOL_ALIASES)) {
  _toolHandlers.set(toolName, async (args, context) =>
    handleComputerUse(normalizeComputerUseCompatToolArgs(action, args), context)
  );
}
getSkillExecutors()
  .then((executors) => {
    for (const [name, executor] of Object.entries(executors)) {
      _toolHandlers.set(name, async (args) => executor(args));
    }
  })
  .catch((err) => {
    console.error("Failed to initialize skill executors:", err);
  });

export async function handleTelegramMedia(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ success: boolean; message: string }> {
  const action = args.action as "photo" | "document" | "video";
  const file = args.file as string;
  const chatId = args.chatId as string | undefined;
  const caption = args.caption as string | undefined;

  if (!file) {
    throw new Error("file is required");
  }

  const channels = channelManager.list();
  const telegramChannel = channels.find((c) => c.type === "telegram" && c.enabled);

  if (!telegramChannel) {
    throw new Error("No active Telegram channel found");
  }

  let targetChatId = chatId;
  if (!targetChatId || targetChatId === "current") {
    if (context?.channel) {
      targetChatId = context.channel;
    } else {
      throw new Error("chatId required when no active Telegram chat context");
    }
  }

  let success = false;
  switch (action) {
    case "photo":
      success = await telegramBot.sendPhoto(telegramChannel.id, targetChatId, file, caption);
      break;
    case "document":
      success = await telegramBot.sendDocument(telegramChannel.id, targetChatId, file, caption);
      break;
    case "video":
      success = await telegramBot.sendVideo(telegramChannel.id, targetChatId, file, caption);
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }

  return {
    success,
    message: success ? `${action} sent successfully` : `Failed to send ${action}`,
  };
}

_toolHandlers.set("telegram_media", handleTelegramMedia);
