import {
  normalizeReasoningModelId,
  usesBinaryReasoning,
  usesProviderAdaptiveReasoning,
  type ReasoningEffort,
} from "../../../shared/reasoning-capabilities";

export const BUILT_IN_REASONING_EFFORT: ReasoningEffort = "medium";

const FULL_DEPTH_BY_DEFAULT_FAMILIES = /(?:^|[/:])glm-(?:4\.[5-9]|5)/;

export function isKnownReasoningModel(
  modelId?: string | null,
  catalogReasoning?: boolean
): boolean {
  if (catalogReasoning === false) return false;
  return FULL_DEPTH_BY_DEFAULT_FAMILIES.test(normalizeReasoningModelId(modelId));
}

export function builtInReasoningEffort(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  catalogReasoning?: boolean
): ReasoningEffort | undefined {
  if (usesProviderAdaptiveReasoning(providerId, modelId) || usesBinaryReasoning(providerId)) {
    return undefined;
  }
  return isKnownReasoningModel(modelId, catalogReasoning) ? BUILT_IN_REASONING_EFFORT : undefined;
}
