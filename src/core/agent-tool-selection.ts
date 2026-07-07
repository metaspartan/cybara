export type AgentToolSelection =
  | { kind: "builtins" }
  | { kind: "explicit"; tools: unknown[] }
  | { kind: "malformed"; reason: string };

export function resolveAgentToolSelection(rawTools: unknown): AgentToolSelection {
  if (rawTools === undefined || rawTools === null) return { kind: "builtins" };
  if (Array.isArray(rawTools)) return { kind: "explicit", tools: rawTools };
  if (typeof rawTools === "string") {
    let current: unknown = rawTools;
    for (let depth = 0; depth < 5; depth++) {
      if (Array.isArray(current)) return { kind: "explicit", tools: current };
      if (typeof current !== "string") break;
      const trimmed = current.trim();
      if (!trimmed) return { kind: "builtins" };
      try {
        current = JSON.parse(trimmed);
      } catch {
        return { kind: "malformed", reason: "unparseable" };
      }
    }
    if (Array.isArray(current)) return { kind: "explicit", tools: current };
    return { kind: "malformed", reason: "non-array" };
  }
  return { kind: "malformed", reason: "non-array" };
}
