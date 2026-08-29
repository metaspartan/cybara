import { getStoredAccountConnector } from "../account-connectors/store";
import { ACCOUNT_CONNECTOR_IDS } from "../account-connectors/types";
import {
  COMPUTER_USE_ACTION_TOOL_ALIASES,
  COMPUTER_USE_COMPAT_TOOL_ALIASES,
} from "../computer-use-actions";
import { config } from "../config";
import { toolSchemas } from "./schemas";
import type { Tool } from "./types";

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
  "nodes",
]);

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
    input_schema: { type: "object", properties },
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

export { toolSchemas };

export function isToolEnabledForAgent(toolName: string): boolean {
  if (toolName === "eval_save") {
    const lab = config.getLabSettings();
    return lab.enabled && lab.goldenTurnsEnabled;
  }
  if (toolName === "eval_replay") return config.getLabSettings().enabled;
  if (toolName === "wallet") return config.get<boolean>("wallet_agent_access_enabled") === true;
  if (toolName === "skill_save") return isSelfImprovingSkillsEnabled();
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

export function isSelfImprovingSkillsEnabled(): boolean {
  return config.get<boolean>("self_improving_skills_enabled") !== false;
}

export function getToolSchemasForLLM(): Omit<Tool, "handler">[] {
  return Object.values(toolSchemas).filter((tool) => isToolEnabledForAgent(tool.name));
}

export function getToolRequiredPermissions(name: string): string[] {
  const tool = toolSchemas[name];
  return tool && Array.isArray(tool.permissions) ? tool.permissions : [];
}

export function isDangerousTool(name: string): boolean {
  if (dangerousToolNames.has(name)) return true;
  return getToolRequiredPermissions(name).some(
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
  if (permissions.length === 0 || contextPermissions.includes("*")) return true;
  return permissions.every((permission) => contextPermissions.includes(permission));
}
