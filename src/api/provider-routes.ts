import { credentialDestinationChanged } from "../core/credential-destination";
import { tables } from "../core/database";
import { discoverProviderModels } from "../core/model-discovery";
import {
  getPluginProviderContribution,
  listPluginProviderContributions,
} from "../core/plugins/runtime";
import {
  createProviderAccountPool,
  deleteProviderAccountPool,
  getProviderAccountPool,
  listProviderAccountPools,
  type ProviderAccountPool,
  type ProviderAccountPoolInput,
  removeProviderFromAccountPools,
  updateProviderAccountPool,
} from "../core/provider-account-pool";
import {
  enrichProviderPlanStatusWithLiveUsage,
  getProviderPlanAvailability,
  getProviderPlanMonitoringConfig,
  getProviderPlanStatus,
  setProviderPlanMonitoringConfig,
} from "../core/provider-plans";
import { normalizeProviderSettings } from "../core/provider-settings";
import {
  providerManager,
  providers,
  type ProviderType,
  resolveProviderType,
} from "../core/providers";
import { invalidateCachedRoute } from "./route-cache";
import {
  buildGoogleAuthHeaders,
  isLikelyGoogleApiKey,
  normalizeOptionalString,
  normalizeSecretString,
  type RouteHandler,
} from "./routes/_shared";
import {
  validateProviderBaseUrlShape,
  validateProviderCredentialShape,
  validatePluginProviderBaseUrl,
} from "./routes/provider-validation";

function providerAccountPoolResponse(pool: ProviderAccountPool): Record<string, unknown> {
  return {
    id: pool.id,
    name: pool.name,
    provider: pool.provider,
    enabled: pool.enabled,
    routing_mode: pool.accounts.some((account) => account.priority !== undefined)
      ? "priority_then_usage"
      : "usage",
    accounts: pool.accounts.map((account) => {
      const provider = providerManager.get(account.providerId);
      return {
        provider_id: account.providerId,
        provider_name: provider?.name ?? account.providerId,
        priority: account.priority ?? null,
      };
    }),
  };
}

function providerAccountPoolInput(
  body: unknown,
  existing?: ProviderAccountPool
): ProviderAccountPoolInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Validation error: Provider pool body is required");
  }
  const record = body as Record<string, unknown>;
  const accounts = Array.isArray(record.accounts)
    ? record.accounts.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const account = entry as Record<string, unknown>;
        const providerId = normalizeOptionalString(account.provider_id ?? account.providerId);
        return providerId
          ? [
              {
                providerId,
                priority: typeof account.priority === "number" ? account.priority : undefined,
              },
            ]
          : [];
      })
    : (existing?.accounts ?? []);
  return {
    name: normalizeOptionalString(record.name) || existing?.name || "",
    provider: normalizeOptionalString(record.provider) || existing?.provider || "",
    enabled: typeof record.enabled === "boolean" ? record.enabled : existing?.enabled !== false,
    accounts,
  };
}

function routeId(params: Record<string, string> | undefined): string {
  const id = params?.id?.trim();
  if (!id) throw new Error("Validation error: Provider id is required");
  return id;
}

export const providerRoutes: Record<string, RouteHandler> = {
  "GET /api/providers": () => providerManager.list(),
  "GET /api/provider-account-pools": () =>
    listProviderAccountPools().map(providerAccountPoolResponse),
  "POST /api/provider-account-pools": (body) =>
    providerAccountPoolResponse(
      createProviderAccountPool(providerAccountPoolInput(body), providerManager.list())
    ),
  "PUT /api/provider-account-pools/:id": (body, params) => {
    const id = routeId(params);
    const existing = getProviderAccountPool(id);
    if (!existing) throw new Error("Provider account pool not found");
    const pool = updateProviderAccountPool(
      id,
      providerAccountPoolInput(body, existing),
      providerManager.list()
    );
    if (!pool) throw new Error("Provider account pool not found");
    return providerAccountPoolResponse(pool);
  },
  "DELETE /api/provider-account-pools/:id": (_body, params) => ({
    success: deleteProviderAccountPool(routeId(params)),
  }),
  "GET /api/providers/available": () => [
    ...Object.entries(providers).map(([key, value]) => ({
      id: key,
      name: value.name,
      description: `Use ${value.name} models`,
      baseUrl: value.baseUrl,
      authType: value.authType,
      oauthFlow: (value as Record<string, unknown>).oauthFlow || null,
      hasOAuthConfig: !!(value as Record<string, unknown>).oauthConfig,
      oauthLoginUrl: (value as Record<string, unknown>).oauthLoginUrl || null,
      models: value.models.map((m) => ({
        id: m.id,
        name: m.name,
        context: m.context,
        maxTokens: m.maxTokens,
        reasoning: m.reasoning,
        input: m.input,
      })),
    })),
    ...listPluginProviderContributions().map((provider) => ({
      id: provider.runtimeId,
      name: provider.name,
      description: `Use ${provider.name} models`,
      baseUrl: provider.baseUrl,
      authType: provider.authType === "none" ? "none" : "api_key",
      oauthFlow: null,
      hasOAuthConfig: false,
      oauthLoginUrl: null,
      models: provider.models.map((model) => ({
        id: model,
        name: model,
        input: ["text"],
      })),
    })),
  ],
  "GET /api/provider-plans/config": () => getProviderPlanMonitoringConfig(),
  "PUT /api/provider-plans/config": (body) => {
    const result = setProviderPlanMonitoringConfig(body);
    invalidateCachedRoute("GET /api/provider-plans/status");
    return result;
  },
  "GET /api/provider-plans/availability": () => getProviderPlanAvailability(),
  "GET /api/provider-plans/status": () =>
    enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus()),
  "POST /api/providers/:id/test": async (_body, params) => {
    const provider = providerManager.getWithCredentials(routeId(params));
    if (!provider) {
      throw new Error("Provider not found");
    }

    const providerInfo = providers[provider.provider as ProviderType];
    if (!providerInfo) {
      throw new Error(`Unknown provider type: ${provider.provider}`);
    }

    const requiresCredentials = providerInfo.authType !== "none";
    const hasCredentials = !!(provider.api_key || provider.access_token || provider.refresh_token);

    if (requiresCredentials && !hasCredentials) {
      return {
        success: false,
        provider: provider.provider,
        message: "Provider credentials are missing",
      };
    }

    if (provider.provider === "ollama") {
      const baseUrl = provider.base_url || providerInfo.baseUrl || "http://localhost:11434";
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        return {
          success: response.ok,
          provider: provider.provider,
          message: response.ok
            ? "Ollama connection verified"
            : `Ollama returned HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          success: false,
          provider: provider.provider,
          message: `Failed to connect to Ollama: ${(error as Error).message}`,
        };
      }
    }

    if (provider.provider === "openai") {
      const apiKey = provider.api_key || provider.access_token;
      const baseUrl = provider.base_url || providerInfo.baseUrl || "https://api.openai.com/v1";
      if (!apiKey) {
        return {
          success: false,
          provider: provider.provider,
          message: "OpenAI API key is missing",
        };
      }

      try {
        const response = await fetch(`${baseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const text = await response.text();
          const safeText = text.slice(0, 300);
          return {
            success: false,
            provider: provider.provider,
            message: `OpenAI auth/model check failed: HTTP ${response.status}${safeText ? ` - ${safeText}` : ""}`,
          };
        }

        return {
          success: true,
          provider: provider.provider,
          message: "OpenAI credentials verified",
        };
      } catch (error) {
        return {
          success: false,
          provider: provider.provider,
          message: `OpenAI test failed: ${(error as Error).message}`,
        };
      }
    }

    if (provider.provider === "elevenlabs") {
      const apiKey = provider.api_key || provider.access_token;
      const baseUrl = (
        provider.base_url ||
        providerInfo.baseUrl ||
        "https://api.elevenlabs.io/v1"
      ).replace(/\/+$/, "");
      if (!apiKey) {
        return {
          success: false,
          provider: provider.provider,
          message: "ElevenLabs API key is missing",
        };
      }

      try {
        const response = await fetch(`${baseUrl}/voices`, {
          headers: {
            "xi-api-key": apiKey,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const text = await response.text();
          const safeText = text.slice(0, 300);
          return {
            success: false,
            provider: provider.provider,
            message: `ElevenLabs voice check failed: HTTP ${response.status}${safeText ? ` - ${safeText}` : ""}`,
          };
        }

        return {
          success: true,
          provider: provider.provider,
          message: "ElevenLabs credentials verified",
        };
      } catch (error) {
        return {
          success: false,
          provider: provider.provider,
          message: `ElevenLabs test failed: ${(error as Error).message}`,
        };
      }
    }

    if (providerInfo.api === "google-generative-ai") {
      const baseUrl = (
        provider.base_url ||
        providerInfo.baseUrl ||
        "https://generativelanguage.googleapis.com/v1beta"
      ).replace(/\/+$/, "");
      if ((providerInfo.authType || "api_key") === "api_key") {
        const storedApiKey = provider.api_key?.trim();
        if (!storedApiKey) {
          return {
            success: false,
            provider: provider.provider,
            message: "Google API key is missing",
          };
        }
        if (/^https?:\/\//i.test(storedApiKey) || !isLikelyGoogleApiKey(storedApiKey)) {
          return {
            success: false,
            provider: provider.provider,
            message:
              "Stored Google API key appears invalid. Paste an AI Studio key that starts with 'AIza'.",
          };
        }
      }
      const authHeaders = buildGoogleAuthHeaders(providerInfo.authType || "api_key", {
        apiKey: provider.api_key ?? undefined,
        accessToken: provider.access_token ?? undefined,
      });
      const probeModelId = providerInfo.models?.[0]?.id || "gemini-3-pro-preview";
      if (!authHeaders.Authorization && !authHeaders["x-goog-api-key"]) {
        return {
          success: false,
          provider: provider.provider,
          message: "Google credentials are missing",
        };
      }

      try {
        const response = await fetch(`${baseUrl}/models/${encodeURIComponent(probeModelId)}`, {
          method: "GET",
          headers: authHeaders,
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const text = await response.text();
          const safeText = text.slice(0, 300);
          return {
            success: false,
            provider: provider.provider,
            message: `Google auth/model check failed: HTTP ${response.status}${safeText ? ` - ${safeText}` : ""}`,
          };
        }
        return {
          success: true,
          provider: provider.provider,
          message: "Google credentials verified",
        };
      } catch (error) {
        return {
          success: false,
          provider: provider.provider,
          message: `Google test failed: ${(error as Error).message}`,
        };
      }
    }

    return {
      success: true,
      provider: provider.provider,
      message: "Provider configuration appears valid",
    };
  },
  "GET /api/providers/:id": (_body, params) => {
    const provider = providerManager.get(routeId(params));
    return provider || { error: "Provider not found" };
  },
  "POST /api/providers": (body) => {
    const data = body as {
      provider: string;
      name: string;
      api_key?: string;
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      base_url?: string;
      settings?: Record<string, unknown>;
      is_default?: boolean;
    };

    const apiKey = normalizeSecretString(data.api_key);
    const accessToken = normalizeSecretString(data.access_token);
    const refreshToken = normalizeSecretString(data.refresh_token);
    const normalizedBaseUrl = normalizeOptionalString(data.base_url);
    if (normalizedBaseUrl) {
      validateProviderBaseUrlShape(normalizedBaseUrl);
    }
    const resolvedProviderType = resolveProviderType(data.provider);
    const pluginProvider = getPluginProviderContribution(data.provider);
    if (!resolvedProviderType && !pluginProvider) {
      throw new Error(`Validation error: unknown provider '${data.provider}'`);
    }
    if (resolvedProviderType) {
      validateProviderCredentialShape(resolvedProviderType, {
        apiKey,
        accessToken,
      });
    } else if (pluginProvider?.authType !== "none" && !apiKey && !accessToken) {
      throw new Error("Validation error: plugin provider API key is required");
    }
    const providerSettings = normalizeProviderSettings(resolvedProviderType || "", data.settings);
    if (resolvedProviderType === "devin" && data.settings && !providerSettings) {
      throw new Error("Validation error: Devin organization ID is invalid");
    }

    if (pluginProvider) {
      const pluginBaseUrl = normalizedBaseUrl || pluginProvider.baseUrl;
      validatePluginProviderBaseUrl(pluginBaseUrl, pluginProvider.allowPrivateEndpoint);
      const id = crypto.randomUUID();
      tables.providers.create({
        id,
        provider: pluginProvider.runtimeId,
        name: normalizeOptionalString(data.name) || data.name,
        api_key: apiKey,
        access_token: accessToken,
        base_url: pluginBaseUrl,
        settings: providerSettings,
        is_default: data.is_default === true,
      });
      for (const model of pluginProvider.models) {
        tables.providerModels.upsert({
          id: crypto.randomUUID(),
          provider_id: id,
          model_id: model,
          model_name: model,
        });
      }
      invalidateCachedRoute("GET /api/provider-plans/status");
      return providerManager.get(id);
    }
    const created = providerManager.create({
      provider: resolvedProviderType as Parameters<typeof providerManager.create>[0]["provider"],
      name: normalizeOptionalString(data.name) || data.name,
      api_key: apiKey,
      access_token: accessToken,
      refresh_token: refreshToken,
      settings: providerSettings,
      expires_at: typeof data.expires_at === "number" ? data.expires_at : undefined,
      base_url: normalizedBaseUrl,
      is_default: data.is_default,
    });
    invalidateCachedRoute("GET /api/provider-plans/status");
    return created;
  },
  "PUT /api/providers/:id": (body, params) => {
    const id = routeId(params);
    const existing = providerManager.getWithCredentials(id);
    if (!existing) {
      throw new Error("Provider not found");
    }

    const data = (body || {}) as Record<string, unknown>;
    const updates: Parameters<typeof providerManager.update>[1] = {};

    if ("name" in data) {
      const normalizedName = normalizeOptionalString(data.name);
      if (normalizedName) {
        updates.name = normalizedName;
      }
    }

    if ("base_url" in data) {
      const normalizedBaseUrl = normalizeOptionalString(data.base_url);
      if (normalizedBaseUrl) {
        const pluginProvider = getPluginProviderContribution(existing.provider);
        if (existing.provider.startsWith("plugin:") && !pluginProvider) {
          throw new Error("Validation error: Plugin provider contribution is unavailable");
        }
        if (pluginProvider) {
          validatePluginProviderBaseUrl(normalizedBaseUrl, pluginProvider.allowPrivateEndpoint);
        } else {
          validateProviderBaseUrlShape(normalizedBaseUrl);
        }
        updates.base_url = normalizedBaseUrl;
      }
    }

    if ("is_default" in data) {
      updates.is_default = data.is_default === true;
    }

    if ("settings" in data) {
      const providerSettings = normalizeProviderSettings(existing.provider, {
        ...(existing.settings || {}),
        ...((data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
          ? data.settings
          : {}) as Record<string, unknown>),
      });
      if (existing.provider === "devin" && !providerSettings) {
        throw new Error("Validation error: Devin organization ID is invalid");
      }
      updates.settings = providerSettings;
    }

    if ("api_key" in data) {
      const normalizedApiKey = normalizeSecretString(data.api_key);
      if (normalizedApiKey) {
        updates.api_key = normalizedApiKey;
      }
    }

    if ("access_token" in data) {
      const normalizedAccessToken = normalizeSecretString(data.access_token);
      if (normalizedAccessToken) {
        updates.access_token = normalizedAccessToken;
      }
    }

    if ("refresh_token" in data) {
      const normalizedRefreshToken = normalizeSecretString(data.refresh_token);
      if (normalizedRefreshToken) {
        updates.refresh_token = normalizedRefreshToken;
      }
    }

    if ("expires_at" in data && typeof data.expires_at === "number") {
      updates.expires_at = data.expires_at;
    }

    const existingProviderType = resolveProviderType(existing.provider);
    const existingBaseUrl =
      existing.base_url ||
      (existingProviderType ? providers[existingProviderType]?.baseUrl : undefined);
    if (
      updates.base_url &&
      credentialDestinationChanged(existingBaseUrl, updates.base_url) &&
      ((existing.api_key && !updates.api_key) ||
        (existing.access_token && !updates.access_token) ||
        (existing.refresh_token && !updates.refresh_token))
    ) {
      throw new Error(
        "Validation error: credentials must be re-entered when changing the provider destination"
      );
    }

    validateProviderCredentialShape(existing.provider, {
      apiKey: updates.api_key,
      accessToken: updates.access_token,
    });

    const success = providerManager.update(id, updates);
    if (success) invalidateCachedRoute("GET /api/provider-plans/status");
    return { success };
  },
  "DELETE /api/providers/:id": (_body, params) => {
    const id = routeId(params);
    const success = providerManager.delete(id);
    if (success) {
      removeProviderFromAccountPools(id);
      invalidateCachedRoute("GET /api/provider-plans/status");
    }
    return { success };
  },
  "GET /api/providers/:id/models": async (_body, params) => {
    const id = routeId(params);
    const provider = providerManager.get(id);
    const discovery = discoverProviderModels(id);
    const waitMs = provider?.provider === "openai-codex" ? 2500 : 600;
    await Promise.race([discovery, Bun.sleep(waitMs)]);
    return providerManager.getModels(id);
  },
  "POST /api/providers/:id/models/discover": async (_body, params) =>
    await discoverProviderModels(routeId(params), { force: true }),
  "POST /api/providers/discover/ollama": async () => await providerManager.discoverOllamaModels(),
};
