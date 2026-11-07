import type { ToolDefinition } from "../database";

function hasAdditionalProperties(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasAdditionalProperties);
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, "additionalProperties")) return true;
  return Object.values(record).some(hasAdditionalProperties);
}

export interface GoogleFunctionDeclarationOptions {
  forceJsonSchema?: boolean;
}

export function googleFunctionDeclaration(
  tool: ToolDefinition,
  options: GoogleFunctionDeclarationOptions = {}
): Record<string, unknown> {
  const schema = tool.input_schema || { type: "object", properties: {} };
  return {
    name: tool.name,
    description: tool.description || "",
    ...(options.forceJsonSchema === true || hasAdditionalProperties(schema)
      ? { parametersJsonSchema: schema }
      : { parameters: schema }),
  };
}
