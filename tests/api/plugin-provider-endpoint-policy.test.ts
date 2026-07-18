import { afterEach, describe, expect, test } from "bun:test";
import { providerRoutes } from "../../src/api/provider-routes";
import {
  registerPluginProviderContribution,
  unregisterPluginProviderContribution,
} from "../../src/core/plugins/provider-registry";
import { providerManager } from "../../src/core/providers";

const contributionKeys: string[] = [];
const providerIds: string[] = [];

afterEach(() => {
  for (const providerId of providerIds.splice(0)) providerManager.delete(providerId);
  for (const key of contributionKeys.splice(0)) unregisterPluginProviderContribution(key);
});

function registerContribution(allowPrivateEndpoint: boolean): string {
  const key = `endpoint-policy-${crypto.randomUUID()}`;
  const runtimeId = `plugin:${key}:provider`;
  contributionKeys.push(key);
  registerPluginProviderContribution(key, {
    pluginId: key,
    id: "provider",
    runtimeId,
    name: "Endpoint policy provider",
    baseUrl: "https://api.example.com/v1",
    api: "openai-compatible",
    authType: "api-key",
    allowPrivateEndpoint,
    models: ["test-model"],
  });
  return runtimeId;
}

function route(name: string) {
  const handler = providerRoutes[name];
  if (!handler) throw new Error(`Missing route ${name}`);
  return handler;
}

describe("plugin provider endpoint policy", () => {
  test("rejects private endpoint overrides during provider creation", () => {
    const runtimeId = registerContribution(false);
    expect(() =>
      route("POST /api/providers")({
        provider: runtimeId,
        name: "Blocked private provider",
        api_key: "test-key",
        base_url: "http://127.0.0.1:9900/v1",
      })
    ).toThrow("Plugin provider endpoint is not public");
  });

  test("rejects private endpoint overrides during provider updates", () => {
    const runtimeId = registerContribution(false);
    const created = route("POST /api/providers")({
      provider: runtimeId,
      name: "Public plugin provider",
      api_key: "test-key",
    }) as { id?: string };
    if (!created.id) throw new Error("Provider was not created");
    providerIds.push(created.id);

    expect(() =>
      route("PUT /api/providers/:id")(
        {
          base_url: "http://169.254.169.254/latest",
          api_key: "replacement-key",
        },
        { id: created.id }
      )
    ).toThrow("Plugin provider endpoint is not public");
  });

  test("allows private overrides only for opted-in plugin providers", () => {
    const runtimeId = registerContribution(true);
    const created = route("POST /api/providers")({
      provider: runtimeId,
      name: "Local plugin provider",
      api_key: "test-key",
      base_url: "http://127.0.0.1:9900/v1",
    }) as { id?: string; base_url?: string };
    if (!created.id) throw new Error("Provider was not created");
    providerIds.push(created.id);
    expect(created.base_url).toBe("http://127.0.0.1:9900/v1");
  });
});
