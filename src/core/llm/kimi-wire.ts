import type { ReasoningEffort } from "../../../shared/reasoning-capabilities";

const KIMI_CODE_PROVIDERS = new Set([
  "kimi-code",
  "kimi-code-oauth",
  "kimi-coding",
  "kimi-oauth",
  "kimi-code-subscription",
]);

const COMBINATOR_KEYS = new Set([
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
]);
const OBJECT_KEYS = new Set([
  "properties",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "required",
  "minProperties",
  "maxProperties",
]);
const ARRAY_KEYS = new Set([
  "items",
  "prefixItems",
  "contains",
  "minItems",
  "maxItems",
  "uniqueItems",
]);
const STRING_KEYS = new Set(["minLength", "maxLength", "pattern", "format"]);
const NUMBER_KEYS = new Set([
  "minimum",
  "maximum",
  "multipleOf",
  "exclusiveMinimum",
  "exclusiveMaximum",
]);
const SINGLE_SCHEMA_KEYS = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
const ARRAY_SCHEMA_KEYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const MAP_SCHEMA_KEYS = new Set([
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)])
  );
}

function jsonValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "object") return "object";
  return typeof value;
}

function inferTypeFromValues(values: unknown[]): string {
  const types = new Set(values.map(jsonValueType));
  if (types.size === 1) return [...types][0] ?? "string";
  if ([...types].every((type) => type === "integer" || type === "number")) return "number";
  return "string";
}

function hasKeyFrom(record: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(record).some((key) => keys.has(key));
}

function inferTypeFromStructure(record: Record<string, unknown>): string {
  if (hasKeyFrom(record, OBJECT_KEYS)) return "object";
  if (hasKeyFrom(record, ARRAY_KEYS)) return "array";
  if (hasKeyFrom(record, STRING_KEYS)) return "string";
  if (hasKeyFrom(record, NUMBER_KEYS)) return "number";
  return "string";
}

function normalizeProperty(record: Record<string, unknown>): void {
  if (!Object.hasOwn(record, "type") && !hasKeyFrom(record, COMBINATOR_KEYS)) {
    const enumValues = record.enum;
    if (Array.isArray(enumValues) && enumValues.length > 0) {
      record.type = inferTypeFromValues(enumValues);
    } else if (Object.hasOwn(record, "const")) {
      record.type = inferTypeFromValues([record.const]);
    } else {
      record.type = inferTypeFromStructure(record);
    }
  }
  normalizeChildren(record);
}

function normalizeChildren(record: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(record)) {
    if (SINGLE_SCHEMA_KEYS.has(key) && isRecord(value)) {
      normalizeProperty(value);
      continue;
    }
    if (ARRAY_SCHEMA_KEYS.has(key) && Array.isArray(value)) {
      for (const child of value) if (isRecord(child)) normalizeProperty(child);
      continue;
    }
    if (MAP_SCHEMA_KEYS.has(key) && isRecord(value)) {
      for (const child of Object.values(value)) if (isRecord(child)) normalizeProperty(child);
      continue;
    }
    if (key === "items") {
      if (isRecord(value)) normalizeProperty(value);
      if (Array.isArray(value)) {
        for (const child of value) if (isRecord(child)) normalizeProperty(child);
      }
    }
  }
}

function isEmptyAssistantContent(content: unknown): boolean {
  if (content === null || content === undefined) return true;
  if (typeof content === "string") return content.trim().length === 0;
  if (!Array.isArray(content)) return false;
  return content.every((part) => {
    if (!isRecord(part)) return false;
    const type = part.type;
    if (type !== "text" && type !== "input_text" && type !== "reasoning") return false;
    const text = part.text ?? part.reasoning;
    return typeof text !== "string" || text.trim().length === 0;
  });
}

export function isKimiCodeProvider(providerId: string | undefined): boolean {
  return KIMI_CODE_PROVIDERS.has((providerId ?? "").trim().toLowerCase());
}

export function kimiThinkingParams(effort: ReasoningEffort): Record<string, unknown> {
  return { thinking: { type: "enabled", effort } };
}

export function normalizeKimiToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cloned = cloneJsonValue(schema);
  if (!isRecord(cloned)) return { type: "object", properties: {} };
  normalizeChildren(cloned);
  return cloned;
}

export function normalizeKimiAssistantToolMessage(
  message: Record<string, unknown>
): Record<string, unknown> {
  if (
    message.role !== "assistant" ||
    !Array.isArray(message.tool_calls) ||
    message.tool_calls.length === 0 ||
    !isEmptyAssistantContent(message.content)
  ) {
    return message;
  }
  const normalized = { ...message };
  delete normalized.content;
  return normalized;
}
