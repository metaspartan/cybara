import {
  DEFAULT_AGENTIC_MAX_ITERATIONS,
  DEFAULT_AGENTIC_MAX_RUNTIME_MS,
  DEFAULT_TOOL_LOOP_CRITICAL_THRESHOLD,
  DEFAULT_TOOL_LOOP_GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_TOOL_LOOP_WARNING_THRESHOLD,
  MAX_AGENTIC_CONFIGURED_ITERATIONS,
  MAX_AGENTIC_MAX_RUNTIME_MS,
  type AgenticLoopPolicy,
} from "./agent-internals";

interface AgenticLoopPolicyInput {
  agentConfig: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  modelParams: Record<string, unknown>;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return undefined;
}

function clampPositiveInt(value: number, max: number): number {
  return Math.min(max, Math.max(1, value));
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveAgenticLoopPolicyFromConfig(
  input: AgenticLoopPolicyInput
): AgenticLoopPolicy {
  const env = input.env ?? {};
  const modelParams = input.modelParams;
  const parsedConfig = input.agentConfig;
  const toolsConfig = objectRecord(parsedConfig.tools);
  const loopDetectionConfig = objectRecord(toolsConfig.loopDetection);

  const modelParamIterations = parsePositiveInt(
    modelParams.max_tool_iterations ??
      modelParams.maxToolIterations ??
      modelParams.tool_loop_iterations ??
      modelParams.toolLoopIterations ??
      modelParams.max_iterations ??
      modelParams.maxIterations
  );
  const configIterations = parsePositiveInt(
    parsedConfig.max_tool_iterations ??
      parsedConfig.maxToolIterations ??
      parsedConfig.tool_loop_iterations ??
      parsedConfig.toolLoopIterations ??
      parsedConfig.max_agentic_iterations ??
      parsedConfig.maxAgenticIterations
  );
  const envIterations = parsePositiveInt(env.CYBARA_AGENTIC_MAX_ITERATIONS);
  const modelRuntimeMs = parsePositiveInt(
    modelParams.max_tool_runtime_ms ??
      modelParams.maxToolRuntimeMs ??
      modelParams.max_agentic_runtime_ms ??
      modelParams.maxAgenticRuntimeMs ??
      modelParams.tool_loop_runtime_ms ??
      modelParams.toolLoopRuntimeMs ??
      modelParams.agentic_timeout_ms ??
      modelParams.agenticTimeoutMs
  );
  const modelRuntimeSeconds = parsePositiveInt(
    modelParams.max_tool_runtime_seconds ??
      modelParams.maxToolRuntimeSeconds ??
      modelParams.max_agentic_runtime_seconds ??
      modelParams.maxAgenticRuntimeSeconds ??
      modelParams.tool_loop_runtime_seconds ??
      modelParams.toolLoopRuntimeSeconds ??
      modelParams.agentic_timeout_seconds ??
      modelParams.agenticTimeoutSeconds
  );
  const configRuntimeMs = parsePositiveInt(
    parsedConfig.max_tool_runtime_ms ??
      parsedConfig.maxToolRuntimeMs ??
      parsedConfig.max_agentic_runtime_ms ??
      parsedConfig.maxAgenticRuntimeMs ??
      parsedConfig.tool_loop_runtime_ms ??
      parsedConfig.toolLoopRuntimeMs ??
      parsedConfig.agentic_timeout_ms ??
      parsedConfig.agenticTimeoutMs
  );
  const configRuntimeSeconds = parsePositiveInt(
    parsedConfig.max_tool_runtime_seconds ??
      parsedConfig.maxToolRuntimeSeconds ??
      parsedConfig.max_agentic_runtime_seconds ??
      parsedConfig.maxAgenticRuntimeSeconds ??
      parsedConfig.tool_loop_runtime_seconds ??
      parsedConfig.toolLoopRuntimeSeconds ??
      parsedConfig.agentic_timeout_seconds ??
      parsedConfig.agenticTimeoutSeconds
  );
  const envRuntimeMs = parsePositiveInt(env.CYBARA_AGENTIC_MAX_RUNTIME_MS);
  const envRuntimeSeconds = parsePositiveInt(env.CYBARA_AGENTIC_MAX_RUNTIME_SECONDS);

  const warningThresholdValue = parsePositiveInt(
    modelParams.tool_loop_warning_threshold ??
      modelParams.toolLoopWarningThreshold ??
      modelParams.loop_warning_threshold ??
      modelParams.loopWarningThreshold ??
      parsedConfig.tool_loop_warning_threshold ??
      parsedConfig.toolLoopWarningThreshold ??
      loopDetectionConfig.warningThreshold ??
      env.CYBARA_TOOL_LOOP_WARNING_THRESHOLD
  );
  const criticalThresholdValue = parsePositiveInt(
    modelParams.tool_loop_critical_threshold ??
      modelParams.toolLoopCriticalThreshold ??
      modelParams.loop_critical_threshold ??
      modelParams.loopCriticalThreshold ??
      parsedConfig.tool_loop_critical_threshold ??
      parsedConfig.toolLoopCriticalThreshold ??
      loopDetectionConfig.criticalThreshold ??
      env.CYBARA_TOOL_LOOP_CRITICAL_THRESHOLD
  );
  const globalCircuitBreakerValue = parsePositiveInt(
    modelParams.tool_loop_global_circuit_breaker_threshold ??
      modelParams.toolLoopGlobalCircuitBreakerThreshold ??
      modelParams.loop_global_circuit_breaker_threshold ??
      modelParams.loopGlobalCircuitBreakerThreshold ??
      parsedConfig.tool_loop_global_circuit_breaker_threshold ??
      parsedConfig.toolLoopGlobalCircuitBreakerThreshold ??
      loopDetectionConfig.globalCircuitBreakerThreshold ??
      env.CYBARA_TOOL_LOOP_GLOBAL_CIRCUIT_BREAKER_THRESHOLD
  );
  const loopDetectionEnabled = parseBoolean(
    modelParams.tool_loop_detection_enabled ??
      modelParams.toolLoopDetectionEnabled ??
      modelParams.loop_detection_enabled ??
      modelParams.loopDetectionEnabled ??
      parsedConfig.tool_loop_detection_enabled ??
      parsedConfig.toolLoopDetectionEnabled ??
      loopDetectionConfig.enabled ??
      env.CYBARA_TOOL_LOOP_DETECTION_ENABLED
  );

  const warningThreshold = clampPositiveInt(
    warningThresholdValue ?? DEFAULT_TOOL_LOOP_WARNING_THRESHOLD,
    1000
  );
  let criticalThreshold = clampPositiveInt(
    criticalThresholdValue ?? DEFAULT_TOOL_LOOP_CRITICAL_THRESHOLD,
    1000
  );
  let globalCircuitBreakerThreshold = clampPositiveInt(
    globalCircuitBreakerValue ?? DEFAULT_TOOL_LOOP_GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
    1000
  );

  if (criticalThreshold <= warningThreshold) {
    criticalThreshold = warningThreshold + 1;
  }
  if (globalCircuitBreakerThreshold <= criticalThreshold) {
    globalCircuitBreakerThreshold = criticalThreshold + 1;
  }

  const maxIterations = clampPositiveInt(
    modelParamIterations ?? configIterations ?? envIterations ?? DEFAULT_AGENTIC_MAX_ITERATIONS,
    MAX_AGENTIC_CONFIGURED_ITERATIONS
  );
  const maxRuntimeMsRaw =
    modelRuntimeMs ??
    (modelRuntimeSeconds ? modelRuntimeSeconds * 1000 : undefined) ??
    configRuntimeMs ??
    (configRuntimeSeconds ? configRuntimeSeconds * 1000 : undefined) ??
    envRuntimeMs ??
    (envRuntimeSeconds ? envRuntimeSeconds * 1000 : undefined);
  const maxRuntimeMs = clampPositiveInt(
    maxRuntimeMsRaw ?? DEFAULT_AGENTIC_MAX_RUNTIME_MS,
    MAX_AGENTIC_MAX_RUNTIME_MS
  );

  return {
    criticalThreshold,
    globalCircuitBreakerThreshold,
    loopDetectionEnabled: loopDetectionEnabled ?? true,
    maxIterations,
    maxRuntimeMs,
    warningThreshold,
  };
}
