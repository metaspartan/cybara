export interface PluginProviderContribution {
  pluginId: string;
  id: string;
  runtimeId: string;
  name: string;
  baseUrl: string;
  api: "openai-compatible" | "anthropic-compatible";
  authType: "api-key" | "none";
  allowPrivateEndpoint: boolean;
  models: string[];
}

const providers = new Map<string, PluginProviderContribution>();

export function registerPluginProviderContribution(
  key: string,
  provider: PluginProviderContribution
): void {
  providers.set(key, provider);
}

export function unregisterPluginProviderContribution(key: string): void {
  providers.delete(key);
}

export function listPluginProviderContributions(): PluginProviderContribution[] {
  return [...providers.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function getPluginProviderContribution(
  runtimeId: string
): PluginProviderContribution | undefined {
  return [...providers.values()].find((provider) => provider.runtimeId === runtimeId);
}
