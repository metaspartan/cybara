import { parseAgentConfig } from "./agent-internals";
import { isLegacyBuiltinSnapshot, normalizeExplicitAgentTools } from "./agent-tool-normalization";
import { resolveAgentToolSelection } from "./agent-tool-selection";
import type { Agent, ToolDefinition } from "./database";
import { getToolSchemasForLLM, isToolEnabledForAgent } from "./tools/index";

export const TOOL_PROFILE_IDS = ["full", "coding", "research", "safe"] as const;
export type ToolProfileId = (typeof TOOL_PROFILE_IDS)[number];

export const TOOLSET_IDS = [
  "files",
  "process",
  "web",
  "memory",
  "sessions",
  "artifacts",
  "wallet",
  "channels",
  "connectors",
  "media",
  "skills",
  "language",
  "planning",
  "discovery",
  "automation",
  "platform",
  "orchestration",
] as const;
export type ToolsetId = (typeof TOOLSET_IDS)[number];

export interface AgentToolPolicy {
  profile: ToolProfileId;
  toolsets: ToolsetId[];
  allowedToolNames: string[];
  offeredTools: ToolDefinition[];
  allowDynamicTools: boolean;
  valid: boolean;
  reason?: string;
}

const exactToolsets: Partial<Record<ToolsetId, string[]>> = {
  sessions: [
    "sessions_spawn",
    "sessions_transfer",
    "sessions_wait",
    "sessions_send",
    "sessions_history",
    "sessions_list",
    "session_status",
    "agents_list",
  ],
  artifacts: ["artifacts"],
  wallet: ["wallet"],
  automation: [
    "cron",
    "kanban_show",
    "kanban_list",
    "kanban_complete",
    "kanban_block",
    "kanban_heartbeat",
    "kanban_comment",
    "kanban_create",
    "kanban_unblock",
    "kanban_link",
  ],
  platform: ["nodes", "clipboard", "http", "data", "env", "gateway", "phone", "voice_call"],
};

const categoryToolsets: Partial<Record<ToolsetId, string>> = {
  files: "file",
  process: "process",
  web: "browser",
  memory: "memory",
  channels: "channel",
  connectors: "connector",
  media: "media",
  skills: "skill",
  language: "lsp",
  planning: "planning",
  discovery: "discovery",
  orchestration: "orchestration",
};

const profileToolsets: Record<ToolProfileId, ToolsetId[]> = {
  full: [...TOOLSET_IDS],
  coding: [
    "files",
    "process",
    "web",
    "memory",
    "sessions",
    "artifacts",
    "channels",
    "media",
    "skills",
    "language",
    "planning",
    "discovery",
    "platform",
    "orchestration",
  ],
  research: [
    "web",
    "memory",
    "sessions",
    "artifacts",
    "channels",
    "media",
    "skills",
    "planning",
    "discovery",
    "platform",
  ],
  safe: ["web", "memory", "skills", "planning", "discovery"],
};

const researchFileTools = ["read", "file_search", "grep", "workspace_index_search"];
const safeToolNames = new Set([
  ...researchFileTools,
  "web_fetch",
  "web_search",
  "x_search",
  "memory_search",
  "session_search",
  "memory_get",
  "memory_context",
  "todo",
  "clarify",
  "tool_search",
  "tool_describe",
  "tool_call",
  "skill_load",
  "summarization",
  "weather",
  "calc",
  "convert",
  "pdf",
  "ocr",
]);

const directToolNames = new Set([
  "read",
  "write",
  "edit",
  "apply_patch",
  "file_search",
  "grep",
  "workspace_index_search",
  "exec",
  "process",
  "git",
  "browser",
  "computer_use",
  "mobile_simulator",
  "web_fetch",
  "web_search",
  "memory_search",
  "session_search",
  "memory_get",
  "memory_save",
  "sessions_spawn",
  "sessions_transfer",
  "sessions_wait",
  "agents_list",
  "message",
  "artifacts",
  "todo",
  "clarify",
  "tool_search",
  "tool_describe",
  "tool_call",
  "skill_load",
  "security_scan",
]);

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "string" && item.trim().length > 0 ? [item.trim()] : []
  );
}

function isProfileId(value: unknown): value is ToolProfileId {
  return typeof value === "string" && TOOL_PROFILE_IDS.includes(value as ToolProfileId);
}

function isToolsetId(value: string): value is ToolsetId {
  return TOOLSET_IDS.includes(value as ToolsetId);
}

function currentTools(): ToolDefinition[] {
  return getToolSchemasForLLM()
    .filter((tool) => isToolEnabledForAgent(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
}

function namesForToolsets(toolsets: ToolsetId[], tools: ToolDefinition[]): Set<string> {
  const names = new Set<string>();
  const schemas = new Map(getToolSchemasForLLM().map((tool) => [tool.name, tool]));
  for (const toolset of toolsets) {
    for (const name of exactToolsets[toolset] ?? []) names.add(name);
    const category = categoryToolsets[toolset];
    if (!category) continue;
    for (const tool of tools) {
      if (schemas.get(tool.name)?.category === category) names.add(tool.name);
    }
  }
  return names;
}

function invalidPolicy(reason: string): AgentToolPolicy {
  return {
    profile: "safe",
    toolsets: [],
    allowedToolNames: [],
    offeredTools: [],
    allowDynamicTools: false,
    valid: false,
    reason,
  };
}

export function resolveAgentToolPolicy(
  agent: Pick<Agent, "id" | "tools" | "config">,
  inheritedAllowedToolNames?: string[]
): AgentToolPolicy {
  const tools = currentTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const selection = resolveAgentToolSelection(agent.tools);
  const config = parseAgentConfig(agent.config, agent.id);
  const configuredProfile = config.tool_profile ?? config.toolProfile;
  const profile: ToolProfileId = isProfileId(configuredProfile) ? configuredProfile : "full";

  if (configuredProfile !== undefined && !isProfileId(configuredProfile)) {
    return invalidPolicy("invalid tool profile");
  }
  if (selection.kind === "malformed") return invalidPolicy(`${selection.reason} tools config`);

  const configuredToolsetsValue = config.toolsets ?? config.tool_sets ?? config.toolSets;
  const disabledToolsetsValue =
    config.disabled_toolsets ?? config.disabled_tool_sets ?? config.disabledToolsets;
  if (configuredToolsetsValue !== undefined && !Array.isArray(configuredToolsetsValue)) {
    return invalidPolicy("invalid toolsets config");
  }
  if (disabledToolsetsValue !== undefined && !Array.isArray(disabledToolsetsValue)) {
    return invalidPolicy("invalid disabled toolsets config");
  }
  const configuredToolsets = stringList(configuredToolsetsValue);
  const disabledToolsets = stringList(disabledToolsetsValue);
  if (configuredToolsets?.some((name) => !isToolsetId(name))) {
    return invalidPolicy("invalid toolset");
  }
  if (disabledToolsets?.some((name) => !isToolsetId(name))) {
    return invalidPolicy("invalid disabled toolset");
  }

  const explicitSelection =
    selection.kind === "explicit" &&
    selection.tools.length > 0 &&
    !isLegacyBuiltinSnapshot(selection.tools);
  const selectedToolsets = Array.from(
    new Set([...profileToolsets[profile], ...(configuredToolsets ?? []).filter(isToolsetId)])
  ).filter((toolset) => !(disabledToolsets ?? []).includes(toolset));
  let allowed = explicitSelection
    ? new Set(
        normalizeExplicitAgentTools(selection.tools)
          .filter((tool) => isToolEnabledForAgent(tool.name))
          .map((tool) => tool.name)
      )
    : namesForToolsets(selectedToolsets, tools);

  if (!explicitSelection && profile === "research") {
    for (const name of researchFileTools) allowed.add(name);
  }
  if (!explicitSelection && profile === "safe") {
    allowed = new Set([...allowed].filter((name) => safeToolNames.has(name)));
    for (const name of researchFileTools) allowed.add(name);
  }

  const policyValue = config.tool_policy ?? config.toolPolicy;
  if (policyValue !== undefined && (typeof policyValue !== "object" || policyValue === null)) {
    return invalidPolicy("invalid tool policy");
  }
  const policy = (policyValue ?? {}) as Record<string, unknown>;
  if (policy.allow !== undefined && !Array.isArray(policy.allow)) {
    return invalidPolicy("invalid tool allow list");
  }
  if (policy.deny !== undefined && !Array.isArray(policy.deny)) {
    return invalidPolicy("invalid tool deny list");
  }
  const allow = stringList(policy.allow);
  const deny = stringList(policy.deny);
  if (allow && allow.length === 0 && Array.isArray(policy.allow) && policy.allow.length > 0) {
    return invalidPolicy("invalid tool allow list");
  }
  if (deny && deny.length === 0 && Array.isArray(policy.deny) && policy.deny.length > 0) {
    return invalidPolicy("invalid tool deny list");
  }
  if (allow) allowed = new Set([...allowed].filter((name) => allow.includes(name)));
  for (const name of deny ?? []) allowed.delete(name);
  if (inheritedAllowedToolNames) {
    const inherited = new Set(inheritedAllowedToolNames);
    allowed = new Set([...allowed].filter((name) => inherited.has(name)));
  }

  const allowedToolNames = [...allowed].filter((name) => byName.has(name));
  const offeredTools = explicitSelection
    ? allowedToolNames.flatMap((name) => {
        const tool = byName.get(name);
        return tool ? [tool] : [];
      })
    : allowedToolNames.flatMap((name) => {
        const tool = directToolNames.has(name) ? byName.get(name) : undefined;
        return tool ? [tool] : [];
      });
  const dynamicSetting = config.allow_dynamic_tools ?? config.allowDynamicTools;
  if (dynamicSetting !== undefined && typeof dynamicSetting !== "boolean") {
    return invalidPolicy("invalid dynamic tool setting");
  }

  return {
    profile,
    toolsets: selectedToolsets,
    allowedToolNames,
    offeredTools,
    allowDynamicTools:
      dynamicSetting === true ||
      (dynamicSetting !== false && !explicitSelection && profile !== "safe"),
    valid: true,
  };
}
