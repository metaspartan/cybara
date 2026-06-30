/**
 * Dynamic tool discovery — search, describe, then call on demand.
 *
 * As cybara accumulates tools (built-in + MCP servers + skills), registering
 * every tool's full schema in the system prompt bloats context. Instead the
 * model uses these three lightweight tools to find what it needs at runtime:
 *
 *   - tool_search    : fuzzy/keyword search across the full inventory -> names + short descriptions
 *   - tool_describe  : fetch the full input schema for one tool (cheap to call before tool_call)
 *   - tool_call      : invoke a discovered tool by name
 *
 * This ports openclaw's tool-search pattern. The inventory combines cybara's
 * built-in tools, registered MCP server tools, and skill-exposed tools.
 */
import { executeTool, toolSchemas } from "./index";
import { getToolSchemasForLLM, type ToolContext } from "../index";
import { mcpManager } from "../../mcp";
import { getSkills } from "../../skills";
import { executeSkill } from "../../skills/index";

export interface InventoryEntry {
  name: string;
  description: string;
  source: "builtin" | "mcp" | "skill";
  /** Full schema, populated lazily by tool_describe. */
}

/** Build the full searchable inventory (built-in + MCP + skills). */
export async function buildToolInventory(): Promise<InventoryEntry[]> {
  const entries: InventoryEntry[] = [];

  for (const tool of getToolSchemasForLLM()) {
    entries.push({
      name: tool.name,
      description: tool.description,
      source: "builtin",
    });
  }

  // MCP server tools.
  try {
    for (const tool of mcpManager.getAllTools()) {
      entries.push({
        name: `${tool.serverId}__${tool.name}`,
        description: tool.description || `MCP tool from ${tool.serverName}`,
        source: "mcp",
      });
    }
  } catch {
    /* MCP registry unavailable — skip. */
  }

  // Skill-exposed tools (skills advertise themselves as callable capabilities).
  try {
    for (const skill of getSkills()) {
      entries.push({
        name: `skill__${skill.name}`,
        description: skill.description,
        source: "skill",
      });
    }
  } catch {
    /* skills unavailable — skip. */
  }

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
  // Word-level token matches (cheap fuzzy boost).
  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (name.includes(token)) s += 8;
    if (desc.includes(token)) s += 4;
  }
  return s;
}

export async function handleToolSearch(args: Record<string, unknown>): Promise<{
  query: string;
  matches: Array<{ name: string; description: string; source: InventoryEntry["source"] }>;
}> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const limit = clampInt(args.limit, 1, 50, 15);
  const inventory = await buildToolInventory();

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

export async function handleToolDescribe(args: Record<string, unknown>): Promise<{
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

  // Built-in tool: return full schema.
  const builtin = toolSchemas[name as keyof typeof toolSchemas];
  if (builtin) {
    return {
      name: builtin.name,
      description: builtin.description,
      source: "builtin",
      inputSchema: builtin.input_schema as Record<string, unknown>,
      found: true,
    };
  }

  // MCP tool: resolve server + tool, return its schema.
  if (name.includes("__")) {
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

  // Skill: describe from the catalog.
  if (name.startsWith("skill__")) {
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

  // Built-in tool.
  if (toolSchemas[name as keyof typeof toolSchemas]) {
    const result = await executeTool(name, toolArgs, context);
    return { name, result };
  }

  // Skill (skill__<name>). Must be checked before the generic "__" MCP branch.
  if (name.startsWith("skill__")) {
    const skillName = name.slice("skill__".length);
    const result = await executeSkill(skillName, toolArgs);
    return { name, result };
  }

  // MCP tool.
  if (name.includes("__")) {
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
