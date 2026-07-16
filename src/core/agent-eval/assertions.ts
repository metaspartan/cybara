import type {
  AgentTrajectory,
  EvalMessage,
  GoldenAssertions,
  GoldenResponseAssertion,
  GoldenToolAssertion,
  StructuralComparison,
  StructuralDifference,
} from "./types";

const MAX_ASSERTION_BYTES = 1_000_000;
const MAX_TOOL_ASSERTIONS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function boundedString(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value.length > limit) throw new Error(`${name} exceeds ${limit} characters`);
  return value;
}

function parseResponseAssertion(value: unknown): GoldenResponseAssertion | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("assertions.response must be an assertion object");
  }
  if (value.type === "exact_text" || value.type === "normalized_text") {
    return {
      type: value.type,
      expected: boundedString(value.expected, "assertions.response.expected", 500_000),
    };
  }
  if (value.type === "regex") {
    const pattern = boundedString(value.pattern, "assertions.response.pattern", 10_000);
    const flags = value.flags === undefined ? undefined : boundedString(value.flags, "flags", 16);
    try {
      new RegExp(pattern, flags);
    } catch (error) {
      throw new Error(`assertions.response regex is invalid: ${String(error)}`);
    }
    return { type: "regex", pattern, ...(flags ? { flags } : {}) };
  }
  if (value.type === "json_schema") {
    if (!isRecord(value.schema)) throw new Error("assertions.response.schema must be an object");
    return { type: "json_schema", schema: value.schema };
  }
  if (value.type === "citations") {
    const minimum = Number(value.minimum);
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 1000) {
      throw new Error("assertions.response.minimum must be an integer from 1 to 1000");
    }
    const domains = Array.isArray(value.domains)
      ? value.domains.map((domain) => boundedString(domain, "citation domain", 253).toLowerCase())
      : undefined;
    return { type: "citations", minimum, ...(domains?.length ? { domains } : {}) };
  }
  throw new Error(`Unsupported response assertion type '${value.type}'`);
}

function parseToolAssertion(value: unknown, position: number): GoldenToolAssertion {
  if (!isRecord(value)) throw new Error(`assertions.tools[${position}] must be an object`);
  const index = Number(value.index);
  if (!Number.isInteger(index) || index < 0 || index > 999) {
    throw new Error(`assertions.tools[${position}].index must be an integer from 0 to 999`);
  }
  const name =
    value.name === undefined
      ? undefined
      : boundedString(value.name, `assertions.tools[${position}].name`, 200);
  const args = value.args === undefined ? undefined : value.args;
  if (args !== undefined && !isRecord(args)) {
    throw new Error(`assertions.tools[${position}].args must be an object`);
  }
  return {
    index,
    ...(name ? { name } : {}),
    ...(args ? { args } : {}),
    ...(own(value, "result") ? { result: value.result } : {}),
  };
}

export function defaultGoldenAssertions(trajectory: AgentTrajectory): GoldenAssertions {
  const content = trajectory.response.content.trim();
  return {
    ...(content
      ? { response: { type: "normalized_text" as const, expected: trajectory.response.content } }
      : {}),
    tools: (trajectory.response.tool_calls ?? []).map((call, index) => ({
      index,
      name: call.name,
      args: call.args ?? call.arguments ?? {},
    })),
  };
}

export function parseGoldenAssertions(
  value: unknown,
  trajectory: AgentTrajectory
): GoldenAssertions {
  if (value === undefined || value === null) return defaultGoldenAssertions(trajectory);
  if (!isRecord(value)) throw new Error("assertions must be an object");
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_ASSERTION_BYTES) {
    throw new Error(`assertions exceed ${MAX_ASSERTION_BYTES} bytes`);
  }
  const tools = value.tools === undefined ? [] : value.tools;
  if (!Array.isArray(tools)) throw new Error("assertions.tools must be an array");
  if (tools.length > MAX_TOOL_ASSERTIONS) {
    throw new Error(`assertions.tools exceeds ${MAX_TOOL_ASSERTIONS} entries`);
  }
  return {
    response: parseResponseAssertion(value.response),
    tools: tools.map(parseToolAssertion),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)])
  );
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function citationUrls(content: string): URL[] {
  const urls = content.match(/https?:\/\/[^\s)>\]}"']+/gi) ?? [];
  return urls.flatMap((value) => {
    try {
      return [new URL(value.replace(/[.,;:!?]+$/, ""))];
    } catch {
      return [];
    }
  });
}

function schemaTypeMatches(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function schemaErrors(value: unknown, schema: Record<string, unknown>, path = "$"): string[] {
  const errors: string[] = [];
  if (typeof schema.type === "string" && !schemaTypeMatches(value, schema.type)) {
    return [`${path} must be ${schema.type}`];
  }
  if (own(schema, "const") && !same(value, schema.const)) errors.push(`${path} must equal const`);
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => same(value, entry))) {
    errors.push(`${path} must match enum`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path} is shorter than minLength`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path} is longer than maxLength`);
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match pattern`);
      } catch {
        errors.push(`${path} has an invalid schema pattern`);
      }
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path} has fewer than minItems`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path} has more than maxItems`);
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) => {
        errors.push(
          ...schemaErrors(item, schema.items as Record<string, unknown>, `${path}[${index}]`)
        );
      });
    }
  }
  if (isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [];
    for (const key of required) {
      if (!own(value, key)) errors.push(`${path}.${key} is required`);
    }
    if (isRecord(schema.properties)) {
      for (const [key, nestedSchema] of Object.entries(schema.properties)) {
        if (own(value, key) && isRecord(nestedSchema)) {
          errors.push(...schemaErrors(value[key], nestedSchema, `${path}.${key}`));
        }
      }
    }
  }
  return errors;
}

function responseAssertionError(
  assertion: GoldenResponseAssertion,
  content: string
): string | null {
  if (assertion.type === "exact_text") {
    return content === assertion.expected ? null : "response text differs";
  }
  if (assertion.type === "normalized_text") {
    return normalizedText(content) === normalizedText(assertion.expected)
      ? null
      : "normalized response text differs";
  }
  if (assertion.type === "regex") {
    return new RegExp(assertion.pattern, assertion.flags).test(content)
      ? null
      : "response does not match regex";
  }
  if (assertion.type === "citations") {
    const urls = citationUrls(content);
    if (urls.length < assertion.minimum) return `response has ${urls.length} citations`;
    const missing = (assertion.domains ?? []).filter(
      (domain) =>
        !urls.some((url) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
    );
    return missing.length ? `response is missing citation domains: ${missing.join(", ")}` : null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return "response is not valid JSON";
  }
  const errors = schemaErrors(parsed, assertion.schema);
  return errors.length ? errors.slice(0, 5).join("; ") : null;
}

function assertionDifferences(
  assertions: GoldenAssertions,
  actual: EvalMessage
): StructuralDifference[] {
  const differences: StructuralDifference[] = [];
  if (assertions.response) {
    const error = responseAssertionError(assertions.response, actual.content);
    if (error) {
      differences.push({
        path: "assertions.response",
        expected: assertions.response,
        actual: error,
        severity: "error",
      });
    }
  }
  for (const assertion of assertions.tools) {
    const call = actual.tool_calls?.[assertion.index];
    if (!call) {
      differences.push({
        path: `assertions.tools.${assertion.index}`,
        expected: assertion,
        actual: null,
        severity: "error",
      });
      continue;
    }
    if (assertion.name && assertion.name !== call.name) {
      differences.push({
        path: `assertions.tools.${assertion.index}.name`,
        expected: assertion.name,
        actual: call.name,
        severity: "error",
      });
    }
    const args = call.args ?? call.arguments ?? {};
    if (assertion.args && !same(assertion.args, args)) {
      differences.push({
        path: `assertions.tools.${assertion.index}.args`,
        expected: assertion.args,
        actual: args,
        severity: "error",
      });
    }
    const checksResult = Object.prototype.hasOwnProperty.call(assertion, "result");
    if (checksResult && !same(assertion.result, call.result)) {
      differences.push({
        path: `assertions.tools.${assertion.index}.result`,
        expected: assertion.result,
        actual: call.result,
        severity: "error",
      });
    }
  }
  return differences;
}

export function applyGoldenAssertions(
  structural: StructuralComparison,
  assertions: GoldenAssertions,
  actual: EvalMessage
): StructuralComparison {
  const additions = assertionDifferences(assertions, actual);
  const differences = [...structural.differences, ...additions];
  const errors = differences.filter((item) => item.severity === "error").length;
  const warnings = differences.length - errors;
  return {
    equivalent: errors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    differences,
  };
}
