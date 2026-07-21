type JsonSchema = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueMatchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function allowedTypes(schema: JsonSchema): string[] {
  if (typeof schema.type === "string") return [schema.type];
  if (!Array.isArray(schema.type)) return [];
  return schema.type.filter((entry): entry is string => typeof entry === "string");
}

function validateVariants(value: unknown, schema: JsonSchema, path: string): string[] {
  const errors: string[] = [];
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isObject) : [];
  if (
    anyOf.length > 0 &&
    !anyOf.some((variant) => validateValue(value, variant, path).length === 0)
  ) {
    errors.push(`${path} does not match any allowed schema`);
  }
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf.filter(isObject) : [];
  if (
    oneOf.length > 0 &&
    oneOf.filter((variant) => validateValue(value, variant, path).length === 0).length !== 1
  ) {
    errors.push(`${path} must match exactly one allowed schema`);
  }
  const allOf = Array.isArray(schema.allOf) ? schema.allOf.filter(isObject) : [];
  for (const variant of allOf) errors.push(...validateValue(value, variant, path));
  return errors;
}

function validateString(value: string, schema: JsonSchema, path: string): string[] {
  const errors: string[] = [];
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push(`${path} must contain at least ${schema.minLength} characters`);
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    errors.push(`${path} must contain at most ${schema.maxLength} characters`);
  }
  if (typeof schema.pattern === "string") {
    try {
      if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} has an invalid format`);
    } catch {
      errors.push(`${path} uses an invalid schema pattern`);
    }
  }
  return errors;
}

function validateNumber(value: number, schema: JsonSchema, path: string): string[] {
  const errors: string[] = [];
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${path} must be at least ${schema.minimum}`);
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    errors.push(`${path} must be at most ${schema.maximum}`);
  }
  if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
    errors.push(`${path} must be greater than ${schema.exclusiveMinimum}`);
  }
  if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
    errors.push(`${path} must be less than ${schema.exclusiveMaximum}`);
  }
  return errors;
}

function validateArray(value: unknown[], schema: JsonSchema, path: string): string[] {
  const errors: string[] = [];
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    errors.push(`${path} must contain at least ${schema.minItems} items`);
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    errors.push(`${path} must contain at most ${schema.maxItems} items`);
  }
  if (schema.uniqueItems === true) {
    const serialized = value.map((entry) => JSON.stringify(entry));
    if (new Set(serialized).size !== serialized.length)
      errors.push(`${path} must contain unique items`);
  }
  const itemSchema = schema.items;
  if (isObject(itemSchema)) {
    value.forEach((entry, index) =>
      errors.push(...validateValue(entry, itemSchema, `${path}[${index}]`))
    );
  }
  return errors;
}

function validateObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: string
): string[] {
  const errors: string[] = [];
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
  if (
    typeof schema.minProperties === "number" &&
    Object.keys(value).length < schema.minProperties
  ) {
    errors.push(`${path} must contain at least ${schema.minProperties} properties`);
  }
  if (
    typeof schema.maxProperties === "number" &&
    Object.keys(value).length > schema.maxProperties
  ) {
    errors.push(`${path} must contain at most ${schema.maxProperties} properties`);
  }
  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (isObject(propertySchema)) {
      errors.push(...validateValue(entry, propertySchema, `${path}.${key}`));
    } else if (schema.additionalProperties === false) {
      errors.push(`${path}.${key} is not allowed`);
    } else if (isObject(schema.additionalProperties)) {
      errors.push(...validateValue(entry, schema.additionalProperties, `${path}.${key}`));
    }
  }
  return errors;
}

function validateValue(value: unknown, schema: JsonSchema, path: string): string[] {
  const errors = validateVariants(value, schema, path);
  const types = allowedTypes(schema);
  if (types.length > 0 && !types.some((type) => valueMatchesType(value, type))) {
    errors.push(`${path} must be ${types.join(" or ")}`);
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    errors.push(`${path} must be one of ${schema.enum.map(String).join(", ")}`);
  }
  if (schema.const !== undefined && !Object.is(schema.const, value)) {
    errors.push(`${path} must equal ${String(schema.const)}`);
  }
  if (typeof value === "string") errors.push(...validateString(value, schema, path));
  if (typeof value === "number") errors.push(...validateNumber(value, schema, path));
  if (Array.isArray(value)) errors.push(...validateArray(value, schema, path));
  if (isObject(value)) errors.push(...validateObject(value, schema, path));
  return errors;
}

export function validateToolArguments(
  args: Record<string, unknown>,
  schema?: Record<string, unknown>
): string[] {
  if (!schema) return [];
  return validateValue(args, schema, "arguments");
}
