import { parseAgentConfig, parseModelParams } from "./agent-internals";
import { normalizeReasoningEffort, type ReasoningEffort } from "./llm/reasoning";

export const AGENT_REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export type AgentReasoningSetting = ReasoningEffort | null;

export function parseAgentReasoningSetting(value: unknown): {
  valid: boolean;
  effort: AgentReasoningSetting;
} {
  if (value === null || value === undefined || value === "") {
    return { valid: true, effort: null };
  }
  const effort = normalizeReasoningEffort(value);
  return effort ? { valid: true, effort } : { valid: false, effort: null };
}

export function readAgentReasoningSetting(config: unknown): AgentReasoningSetting {
  const parsed = parseAgentConfig(config);
  const params = parseModelParams(parsed.model_params ?? parsed.modelParams);
  return normalizeReasoningEffort(params.reasoning_effort ?? params.reasoningEffort);
}

export function withAgentReasoningSetting(
  config: unknown,
  effort: AgentReasoningSetting
): Record<string, unknown> {
  const next = { ...parseAgentConfig(config) };
  const params = { ...parseModelParams(next.model_params ?? next.modelParams) };
  delete next.modelParams;
  delete params.reasoningEffort;
  if (effort) {
    params.reasoning_effort = effort;
  } else {
    delete params.reasoning_effort;
  }
  if (Object.keys(params).length > 0) {
    next.model_params = params;
  } else {
    delete next.model_params;
  }
  return next;
}
