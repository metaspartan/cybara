import { mcpManager } from "../mcp";
import { createEligibilityContext, filterEligibleSkills, loadAllSkills } from "../skills";
import { tables } from "../database";
import { toolSchemas } from "../tools";

export type ChatCapabilityKind = "skill" | "mcp_server" | "mcp" | "agent" | "tool";

export interface ChatCapabilityOption {
  kind: ChatCapabilityKind;
  token: string;
  name: string;
  description: string;
  source: string;
}

interface ResolvedChatCapability extends ChatCapabilityOption {
  instruction: string;
}

export function normalizeCapabilityAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function skillCapabilities(workspaceDir?: string): Promise<ResolvedChatCapability[]> {
  const loaded = await loadAllSkills({ workspaceDir });
  return filterEligibleSkills(loaded, createEligibilityContext()).map((entry) => {
    const token = `@${normalizeCapabilityAlias(entry.skill.name)}`;
    const instruction = entry.filePath.startsWith("builtin:")
      ? `For ${token}, do not call read or search for a SKILL.md. Follow these complete inline skill instructions: ${JSON.stringify(entry.skill.instructions)}`
      : `For ${token}, read ${JSON.stringify(entry.filePath)} with the read tool and follow that skill for this turn.`;
    return {
      kind: "skill",
      token,
      name: entry.skill.name,
      description: entry.skill.description,
      source: "Skill",
      instruction,
    };
  });
}

function mcpServerCapabilities(): ResolvedChatCapability[] {
  const byServer = new Map<string, { name: string; toolCount: number }>();
  for (const tool of mcpManager.getAllTools()) {
    const existing = byServer.get(tool.serverName);
    if (existing) existing.toolCount += 1;
    else byServer.set(tool.serverName, { name: tool.serverName, toolCount: 1 });
  }
  return [...byServer.values()].map((server) => {
    const token = `@${normalizeCapabilityAlias(server.name)}`;
    return {
      kind: "mcp_server",
      token,
      name: server.name,
      description: `MCP server · ${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`,
      source: "MCP server",
      instruction: `For ${token}, prefer tools from the ${JSON.stringify(server.name)} MCP server for this turn: use tool_search to find its tools, then tool_describe and tool_call to invoke them.`,
    };
  });
}

function agentCapabilities(): ResolvedChatCapability[] {
  try {
    const agents = tables.agents.all() as Array<{ name?: string; type?: string }>;
    return agents
      .filter((agent) => typeof agent.name === "string" && agent.name.trim().length > 0)
      .map((agent) => {
        const name = agent.name as string;
        const token = `@${normalizeCapabilityAlias(name)}`;
        return {
          kind: "agent" as const,
          token,
          name,
          description: `Delegate to the ${name} agent`,
          source: "Agent",
          instruction: `For ${token}, delegate the relevant part of this task to the ${JSON.stringify(name)} agent using the sessions_spawn or subagents tool, then incorporate its result.`,
        };
      });
  } catch {
    return [];
  }
}

function toolCapabilities(): ResolvedChatCapability[] {
  return Object.values(toolSchemas).map((tool) => {
    const token = `@${normalizeCapabilityAlias(tool.name)}`;
    return {
      kind: "tool",
      token,
      name: tool.name,
      description: tool.description.slice(0, 140),
      source: "Tool",
      instruction: `For ${token}, use the ${JSON.stringify(tool.name)} built-in tool when relevant to this turn.`,
    };
  });
}

function mcpCapabilities(): ResolvedChatCapability[] {
  return mcpManager.getAllTools().map((tool) => {
    const serverAlias = normalizeCapabilityAlias(tool.serverName);
    const toolAlias = normalizeCapabilityAlias(tool.name);
    const token = `@${serverAlias}/${toolAlias}`;
    const canonicalName = `${tool.serverId}__${tool.name}`;
    return {
      kind: "mcp",
      token,
      name: tool.name,
      description: tool.description || `Tool from ${tool.serverName}`,
      source: tool.serverName,
      instruction: `For ${token}, use tool_describe with ${JSON.stringify(canonicalName)}, then invoke it through tool_call with the required arguments.`,
    };
  });
}

async function resolvedCapabilities(workspaceDir?: string): Promise<ResolvedChatCapability[]> {
  const unique = new Map<string, ResolvedChatCapability>();
  for (const capability of [
    ...(await skillCapabilities(workspaceDir)),
    ...mcpServerCapabilities(),
    ...mcpCapabilities(),
    ...agentCapabilities(),
    ...toolCapabilities(),
  ]) {
    if (!unique.has(capability.token)) unique.set(capability.token, capability);
  }
  return [...unique.values()].sort((left, right) =>
    left.token.localeCompare(right.token, undefined, { sensitivity: "base" })
  );
}

export async function listChatCapabilities(workspaceDir?: string): Promise<ChatCapabilityOption[]> {
  return (await resolvedCapabilities(workspaceDir)).map(
    ({ instruction: _instruction, ...capability }) => capability
  );
}

export async function resolveChatCapabilityMentions(
  message: string,
  workspaceDir?: string
): Promise<{
  mentions: ChatCapabilityOption[];
  instruction: string | null;
}> {
  const available = new Map(
    (await resolvedCapabilities(workspaceDir)).map((item) => [item.token.toLowerCase(), item])
  );
  const selected = new Map<string, ResolvedChatCapability>();
  const matches = message.matchAll(
    /(^|\s)(@[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?)(?=$|\s|[.,!?;:])/g
  );
  for (const match of matches) {
    const token = match[2]?.toLowerCase();
    const capability = token ? available.get(token) : undefined;
    if (capability) selected.set(capability.token, capability);
  }
  const mentions = [...selected.values()];
  if (mentions.length === 0) return { mentions: [], instruction: null };
  return {
    mentions: mentions.map(({ instruction: _instruction, ...capability }) => capability),
    instruction: [
      "The user explicitly selected these capabilities for this turn. Use each selected capability when it is relevant to the request, unless doing so would be unsafe or impossible.",
      ...mentions.map((mention) => `- ${mention.instruction}`),
    ].join("\n"),
  };
}

export async function applyChatCapabilityMentions<T extends { role: string; content: string }>(
  messages: T[],
  userMessage: string,
  workspaceDir?: string
): Promise<T[]> {
  const resolved = await resolveChatCapabilityMentions(userMessage, workspaceDir);
  return applyChatCapabilityInstruction(messages, resolved.instruction);
}

export function applyChatCapabilityInstruction<T extends { role: string; content: string }>(
  messages: T[],
  instruction: string | null
): T[] {
  if (!instruction) return messages;
  const output = messages.map((message) => ({ ...message })) as T[];
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (output[index]?.role !== "user") continue;
    output[index] = {
      ...output[index],
      content: `${output[index].content}\n\n<selected_capabilities>\n${instruction}\n</selected_capabilities>`,
    } as T;
    break;
  }
  return output;
}
