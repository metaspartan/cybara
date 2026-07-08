import type { ToolDefinition } from "./database";
import { getToolSchemasForLLM, toolSchemas } from "./tools/index";

const legacyBuiltinSnapshotMarkers = [
  "read",
  "write",
  "exec",
  "browser",
  "web_search",
  "memory_search",
  "sessions_spawn",
  "sessions_send",
];

function toolName(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (
    entry &&
    typeof entry === "object" &&
    typeof (entry as { name?: unknown }).name === "string"
  ) {
    return String((entry as { name: string }).name).trim();
  }
  return "";
}

function currentToolDefinition(tool: {
  name: string;
  description?: string;
  input_schema?: unknown;
}): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Record<string, unknown> | undefined,
  };
}

export function isLegacyBuiltinSnapshot(tools: unknown[]): boolean {
  if (tools.length < 20) return false;
  const names = new Set(tools.map(toolName).filter(Boolean));
  return legacyBuiltinSnapshotMarkers.every((name) => names.has(name));
}

export function normalizeExplicitAgentTools(tools: unknown[]): ToolDefinition[] {
  if (isLegacyBuiltinSnapshot(tools)) {
    return getToolSchemasForLLM().map(currentToolDefinition);
  }

  return tools.flatMap((entry) => {
    const name = toolName(entry);
    if (!name) return [];
    const current = toolSchemas[name];
    if (current) {
      return [currentToolDefinition(current)];
    }
    return typeof entry === "object" && entry !== null ? [entry as ToolDefinition] : [{ name }];
  });
}
