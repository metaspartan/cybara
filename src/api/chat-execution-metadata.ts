import type { AgentExecutionResult } from "../core/agent";
import type { SessionModelMetadata } from "../core/session-context";

export function executionMetadataFromResult(
  result: AgentExecutionResult
): SessionModelMetadata | null {
  const metadata: SessionModelMetadata = {
    provider: result.provider,
    provider_id: result.provider_id,
    provider_name: result.provider_name,
    model: result.model,
  };
  return Object.values(metadata).some(
    (value) => typeof value === "string" && value.trim().length > 0
  )
    ? metadata
    : null;
}
