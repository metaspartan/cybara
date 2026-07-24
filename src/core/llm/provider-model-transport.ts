export interface ProviderModelTransport {
  id: string;
  api?: string;
}

export function resolveProviderModelApiFamily(
  providerApi: string | undefined,
  models: readonly ProviderModelTransport[] | undefined,
  modelId: string
): string {
  const normalizedModelId = modelId.trim().toLowerCase();
  const model = models?.find((entry) => entry.id.trim().toLowerCase() === normalizedModelId);
  return model?.api || providerApi || "openai-completions";
}

export function supportsForcedToolChoice(providerId: string | undefined): boolean {
  const normalized = (providerId || "").trim().toLowerCase();
  return normalized !== "opencode-go" && normalized !== "opencode-go-zen";
}
