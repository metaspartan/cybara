import type {
  EvalMessage,
  StructuralComparison,
  StructuralDifference,
  StructuralToolCall,
  TrajectoryStructure,
} from "./types";

const RESULT_KEY_LIMIT = 32;
const RESULT_DEPTH_LIMIT = 3;

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function extractResultKinds(
  value: unknown,
  prefix = "",
  depth = 0,
  output: Record<string, string> = {}
): Record<string, string> {
  if (Object.keys(output).length >= RESULT_KEY_LIMIT) return output;
  if (depth >= RESULT_DEPTH_LIMIT || value === null || typeof value !== "object") {
    if (prefix) output[prefix] = valueKind(value);
    return output;
  }
  if (Array.isArray(value)) {
    if (prefix) output[prefix] = "array";
    const first = value[0];
    if (first !== undefined) extractResultKinds(first, `${prefix}[]`, depth + 1, output);
    return output;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (Object.keys(output).length >= RESULT_KEY_LIMIT) break;
    const path = prefix ? `${prefix}.${key}` : key;
    output[path] = valueKind(nested);
    extractResultKinds(nested, path, depth + 1, output);
  }
  return output;
}

function structuredContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|```|\|.+\|)/.test(trimmed);
}

export function buildTrajectoryStructure(response: EvalMessage): TrajectoryStructure {
  const tools: StructuralToolCall[] = (response.tool_calls ?? []).map((call) => {
    const args = call.args ?? call.arguments ?? {};
    const resultKinds = extractResultKinds(call.result);
    return {
      name: call.name.trim().toLowerCase(),
      status: (call.status ?? (call.error ? "error" : "completed")).trim().toLowerCase(),
      argumentKeys: Object.keys(args).sort(),
      resultKeys: Object.keys(resultKinds).sort(),
      resultKinds,
    };
  });
  const content = response.content.trim();
  return {
    tools,
    response: {
      hasContent: content.length > 0,
      hasThinking: typeof response.thinking === "string" && response.thinking.trim().length > 0,
      contentKind:
        content.length === 0 ? "empty" : structuredContent(content) ? "structured" : "text",
    },
  };
}

function difference(
  differences: StructuralDifference[],
  path: string,
  expected: unknown,
  actual: unknown,
  severity: "error" | "warning" = "error"
): void {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return;
  differences.push({ path, expected, actual, severity });
}

export function compareTrajectoryStructures(
  expected: TrajectoryStructure,
  actual: TrajectoryStructure
): StructuralComparison {
  const differences: StructuralDifference[] = [];
  difference(
    differences,
    "tools.order",
    expected.tools.map((tool) => tool.name),
    actual.tools.map((tool) => tool.name)
  );
  const count = Math.max(expected.tools.length, actual.tools.length);
  for (let index = 0; index < count; index += 1) {
    const expectedTool = expected.tools[index];
    const actualTool = actual.tools[index];
    if (!expectedTool || !actualTool || expectedTool.name !== actualTool.name) continue;
    difference(differences, `tools.${index}.status`, expectedTool.status, actualTool.status);
    difference(
      differences,
      `tools.${index}.argumentKeys`,
      expectedTool.argumentKeys,
      actualTool.argumentKeys,
      "warning"
    );
    difference(
      differences,
      `tools.${index}.resultKeys`,
      expectedTool.resultKeys,
      actualTool.resultKeys
    );
    for (const key of expectedTool.resultKeys) {
      difference(
        differences,
        `tools.${index}.resultKinds.${key}`,
        expectedTool.resultKinds[key],
        actualTool.resultKinds[key]
      );
    }
  }
  difference(
    differences,
    "response.hasContent",
    expected.response.hasContent,
    actual.response.hasContent
  );
  difference(
    differences,
    "response.contentKind",
    expected.response.contentKind,
    actual.response.contentKind,
    "warning"
  );
  const errors = differences.filter((item) => item.severity === "error").length;
  const warnings = differences.length - errors;
  const penalty = errors * 20 + warnings * 5;
  return {
    equivalent: errors === 0,
    score: Math.max(0, 100 - penalty),
    differences,
  };
}
