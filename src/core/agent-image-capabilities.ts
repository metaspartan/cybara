import type { Agent, ProviderModel } from "./database";
import { parseAgentConfig } from "./agent-internals";
import { providerManager } from "./providers";

export type AgentImageInputMode = "auto" | "enabled" | "disabled";

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

export function readAgentImageInputMode(config: unknown): AgentImageInputMode {
  const parsed = parseAgentConfig(config);
  const value = parsed.image_input ?? parsed.supports_images ?? parsed.supportsImages;
  if (value === true || value === "enabled" || value === "vision") return "enabled";
  if (value === false || value === "disabled" || value === "text") return "disabled";
  return "auto";
}

export function readAgentImageSupportOverride(config: unknown): boolean | undefined {
  const mode = readAgentImageInputMode(config);
  if (mode === "enabled") return true;
  if (mode === "disabled") return false;
  return undefined;
}

export function agentSupportsImages(
  agent: Pick<Agent, "provider_id" | "model" | "config"> | undefined,
  modelOverride?: string
): boolean {
  const override = readAgentImageSupportOverride(agent?.config);
  if (override !== undefined) return override;
  if (!agent?.provider_id) return false;
  return providerModelSupportsImages(agent.provider_id, modelOverride || agent.model || "");
}

export function agentImageSupportById(
  agents: readonly Pick<Agent, "id" | "provider_id" | "model" | "config">[]
): Map<string, boolean> {
  const modelsByProvider = providerManager.getModelsBatch(
    agents.flatMap((agent) => (agent.provider_id ? [agent.provider_id] : []))
  );
  const support = new Map<string, boolean>();
  for (const agent of agents) {
    const override = readAgentImageSupportOverride(agent.config);
    if (override !== undefined) {
      support.set(agent.id, override);
      continue;
    }
    const target = agent.model?.trim().toLowerCase();
    const models = agent.provider_id ? modelsByProvider.get(agent.provider_id) : undefined;
    const model = target
      ? models?.find((candidate) => candidate.model_id.trim().toLowerCase() === target)
      : undefined;
    support.set(
      agent.id,
      !!model && inputTypes(model.input_types).some((item) => item.toLowerCase() === "image")
    );
  }
  return support;
}
