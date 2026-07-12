import type { Agent, ProviderModel } from "./database";
import { providerManager } from "./providers";

function inputTypes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return value.split(",").map((item) => item.trim());
  }
}

export function providerModelSupportsImages(providerId: string, modelId: string): boolean {
  const target = modelId.trim().toLowerCase();
  if (!providerId || !target) return false;
  const model = (providerManager.getModels(providerId) as ProviderModel[]).find(
    (item) => item.model_id.trim().toLowerCase() === target
  );
  return !!model && inputTypes(model.input_types).some((item) => item.toLowerCase() === "image");
}

export function agentSupportsImages(
  agent: Pick<Agent, "provider_id" | "model"> | undefined,
  modelOverride?: string
): boolean {
  if (!agent?.provider_id) return false;
  return providerModelSupportsImages(agent.provider_id, modelOverride || agent.model || "");
}
