import { executeTool, toolSchemas } from "./index";
import { getToolSchemasForLLM, type ToolContext } from "../index";
import { mcpManager } from "../../mcp";
import { getSkills } from "../../skills";
import { executeSkill } from "../../skills/index";

export interface InventoryEntry {
  name: string;
  description: string;
  source: "builtin" | "mcp" | "skill";
}

export async function buildToolInventory(context?: ToolContext): Promise<InventoryEntry[]> {
  const entries: InventoryEntry[] = [];
  const allowed = context?.allowedToolNames ? new Set(context.allowedToolNames) : undefined;

  for (const tool of getToolSchemasForLLM()) {
    if (allowed && !allowed.has(tool.name)) continue;
    entries.push({
      name: tool.name,
      description: tool.description,
      source: "builtin",
    });
  }

  try {
    if (context?.allowDynamicTools === false) throw new Error("disabled");
    for (const tool of mcpManager.getAllTools()) {
      entries.push({
        name: `${tool.serverId}__${tool.name}`,
        description: tool.description || `MCP tool from ${tool.serverName}`,
        source: "mcp",
      });
    }
  } catch {}

  try {
    if (context?.allowDynamicTools === false) throw new Error("disabled");
    for (const skill of getSkills()) {
      entries.push({
        name: `skill__${skill.name}`,
        description: skill.description,
        source: "skill",
      });
    }
  } catch {}

  return entries;
}

function score(entry: InventoryEntry, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const name = entry.name.toLowerCase();
  const desc = entry.description.toLowerCase();
  let s = 0;
  if (name === q) s += 100;
  if (name.includes(q)) s += 40;
  if (desc.includes(q)) s += 20;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (name.includes(token)) s += 8;
    if (desc.includes(token)) s += 4;
  }
  return s;
}

export async function handleToolSearch(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  query: string;
  matches: Array<{ name: string; description: string; source: InventoryEntry["source"] }>;
}> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const limit = clampInt(args.limit, 1, 50, 15);
  const inventory = await buildToolInventory(context);

  const ranked = inventory
    .map((entry) => ({ entry, s: score(entry, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => ({
      name: x.entry.name,
      description: x.entry.description,
      source: x.entry.source,
    }));

  return { query, matches: ranked };
}

export async function handleToolDescribe(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  name: string;
  description: string;
  source: InventoryEntry["source"];
  inputSchema?: Record<string, unknown>;
  found: boolean;
}> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) {
    throw new Error("Validation error: 'name' is required.");
  }

  const builtin = toolSchemas[name as keyof typeof toolSchemas];
  if (builtin) {
    if (context?.allowedToolNames && !context.allowedToolNames.includes(name)) {
      return { name, description: "", source: "builtin", found: false };
    }
    return {
      name: builtin.name,
      description: builtin.description,
      source: "builtin",
      inputSchema: builtin.input_schema as Record<string, unknown>,
      found: true,
    };
  }

  if (name.includes("__") && context?.allowDynamicTools !== false) {
    const [serverId, toolName] = name.split("__", 2);
    const status = mcpManager.getStatus(serverId);
    const tool = status?.tools.find((t) => t.name === toolName);
    if (tool) {
      return {
        name,
        description: tool.description,
        source: "mcp",
        inputSchema: tool.inputSchema as Record<string, unknown>,
        found: true,
      };
    }
  }

  if (name.startsWith("skill__") && context?.allowDynamicTools !== false) {
    const skillName = name.slice("skill__".length);
    const skill = getSkills().find((s) => s.name === skillName);
    if (skill) {
      return {
        name,
        description: skill.description,
        source: "skill",
        inputSchema: {
          type: "object",
          properties: { input: { type: "string", description: "The task for the skill" } },
        },
        found: true,
      };
    }
  }

  return { name, description: "", source: "builtin", found: false };
}

export async function handleToolCall(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ name: string; result: unknown }> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const toolArgs = (args.arguments as Record<string, unknown> | undefined) ?? {};
  if (!name) {
    throw new Error("Validation error: 'name' is required.");
  }

  if (toolSchemas[name as keyof typeof toolSchemas]) {
    const result = await executeTool(name, toolArgs, context);
    return { name, result };
  }

  if (name.startsWith("skill__")) {
    if (context?.allowDynamicTools === false) {
      throw new Error(`Tool "${name}" is not enabled for this agent.`);
    }
    const skillName = name.slice("skill__".length);
    const result = await executeSkill(skillName, toolArgs);
    return { name, result };
  }

  if (name.includes("__")) {
    if (context?.allowDynamicTools === false) {
      throw new Error(`Tool "${name}" is not enabled for this agent.`);
    }
    const [serverId, toolName] = name.split("__", 2);
    const result = await mcpManager.callTool(serverId, toolName, toolArgs);
    return { name, result };
  }

  throw new Error(
    `Unknown tool "${name}". Use tool_search to find available tools, then tool_describe to see its schema.`
  );
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
