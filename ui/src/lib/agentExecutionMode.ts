export type AgentExecutionMode = "direct" | "fused";

export function readAgentExecutionMode(config: Record<string, unknown>): AgentExecutionMode {
  return config.tool_execution_mode === "fused" ? "fused" : "direct";
}

export function setAgentExecutionMode(
  config: Record<string, unknown>,
  value: FormDataEntryValue | null
): Record<string, unknown> {
  if (value === "fused") return { ...config, tool_execution_mode: "fused" };
  const next = { ...config };
  delete next.tool_execution_mode;
  return next;
}
