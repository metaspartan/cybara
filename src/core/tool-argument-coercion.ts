type JsonObject = Record<string, unknown>;

const toolArgumentAliases: Record<string, Record<string, string[]>> = {
  read: { path: ["file"] },
};

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function schemaTypes(schema: JsonObject): string[] {
  const type = schema.type;
  if (typeof type === "string") return [type];
  if (Array.isArray(type))
    return type.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function schemaAllowsNull(schema: JsonObject | undefined): boolean {
  if (!schema) return false;
  if (schema.nullable === true) return true;
  if (schemaTypes(schema).includes("null")) return true;
  for (const key of ["anyOf", "oneOf"]) {
    const variants = schema[key];
    if (!Array.isArray(variants)) continue;
    if (
      variants.some((variant) => isJsonObject(variant) && schemaTypes(variant).includes("null"))
    ) {
      return true;
    }
  }
  return false;
}

function parseJsonString(value: string, guard: (parsed: unknown) => boolean): unknown {
  try {
    const parsed = JSON.parse(value);
    return guard(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function coerceStringValue(value: string, schema: JsonObject): unknown {
  const trimmed = value.trim();
  if (schemaAllowsNull(schema) && trimmed.toLowerCase() === "null") return null;

  for (const type of schemaTypes(schema)) {
    if (type === "string") continue;
    if (type === "integer" || type === "number") {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) continue;
      if (type === "integer" && !Number.isInteger(numeric)) continue;
      return numeric;
    }
    if (type === "boolean") {
      if (trimmed.toLowerCase() === "true") return true;
      if (trimmed.toLowerCase() === "false") return false;
    }
    if (type === "array") {
      const parsed = parseJsonString(trimmed, Array.isArray);
      if (parsed !== value) return parsed;
    }
    if (type === "object") {
      const parsed = parseJsonString(trimmed, isJsonObject);
      if (parsed !== value) return parsed;
    }
    if (type === "null" && trimmed.toLowerCase() === "null") return null;
  }

  return value;
}

function coerceValue(value: unknown, schema: JsonObject): unknown {
  if (typeof value === "string") {
    const coerced = coerceStringValue(value, schema);
    if (coerced !== value) return coerced;
  }
  if (
    schemaTypes(schema).includes("array") &&
    value !== null &&
    value !== undefined &&
    !Array.isArray(value)
  ) {
    return [value];
  }
  return value;
}

export function coerceToolArguments(
  toolName: string,
  args: Record<string, unknown>,
  inputSchema?: Record<string, unknown>
): Record<string, unknown> {
  if (!isJsonObject(args) || !isJsonObject(inputSchema)) return args;
  const properties = inputSchema.properties;
  if (!isJsonObject(properties)) return args;

  let next: Record<string, unknown> | undefined;
  for (const [key, aliases] of Object.entries(toolArgumentAliases[toolName] || {})) {
    if (args[key] !== undefined) continue;
    const alias = aliases.find((candidate) => args[candidate] !== undefined);
    if (!alias) continue;
    next ??= { ...args };
    next[key] = args[alias];
  }
  for (const [key, value] of Object.entries(args)) {
    const propertySchema = properties[key];
    if (!isJsonObject(propertySchema)) continue;
    const coerced = coerceValue(value, propertySchema);
    if (coerced === value) continue;
    next ??= { ...args };
    next[key] = coerced;
  }

  return next || args;
}
