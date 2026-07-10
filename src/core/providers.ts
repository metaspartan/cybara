import { tables, type Provider, type ProviderModel } from "./database";
import { codingProviderCatalog } from "./providers/catalog-coding";
import { cloudProviderCatalog } from "./providers/catalog-cloud";
import { foundationProviderCatalog } from "./providers/catalog-foundation";
import { integrationProviderCatalog } from "./providers/catalog-integrations";

export const providers = {
  ...foundationProviderCatalog,
  ...integrationProviderCatalog,
  ...codingProviderCatalog,
  ...cloudProviderCatalog,
} as const;

export type ProviderType = keyof typeof providers;

const PROVIDER_TYPE_ALIASES: Record<string, ProviderType> = {
  "google-antigravity": "antigravity",
  "gemini-cli": "google-gemini-cli",
  "github-copilot": "github_copilot",
  opencode: "opencode_zen",
  zai: "z.ai",
  "z-ai": "z.ai",
  "zai-coding": "z.ai-coding",
  "kimi-coding": "kimi-code",
  "moonshot-ai": "moonshot",
  moonshotai: "moonshot",
  "minimax-cn": "minimax",
  "minimax-portal-cn": "minimax-portal",
  dashscope: "alibaba",
  "dashscope-intl": "alibaba",
  qwencloud: "alibaba",
  modelstudio: "alibaba",
  "qwen-oauth": "alibaba",
  "qwen-portal": "alibaba",
  "novita-ai": "novita",
  novitaai: "novita",
  "gmi-cloud": "gmi",
  gmicloud: "gmi",
  "opencode-go-zen": "opencode-go",
  "tencent-tokenhub": "tencent",
  ollama_cloud: "ollama-cloud",
  "grok-oauth": "xai-oauth",
  "grok-build": "xai-oauth",
};

export function resolveProviderType(value: string | undefined): ProviderType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized in providers) return normalized as ProviderType;
  return PROVIDER_TYPE_ALIASES[normalized];
}

class ProviderManager {
  private authoritativeModelIds = new Map<string, Set<string>>();

  private mergeWithStaticConfig(dbProvider: Provider): Provider {
    const staticConfig = providers[dbProvider.provider as ProviderType];
    if (!staticConfig) return dbProvider;
    const baseUrl =
      dbProvider.provider === "openai-codex" &&
      typeof dbProvider.base_url === "string" &&
      dbProvider.base_url.trim().toLowerCase() === "https://api.openai.com/v1"
        ? staticConfig.baseUrl
        : dbProvider.base_url;
    return {
      ...dbProvider,
      base_url: baseUrl,
      headers: (staticConfig as { headers?: Record<string, string> }).headers,
    };
  }

  private hasSecretCredential(provider: Provider): boolean {
    return !!(provider.api_key || provider.access_token || provider.refresh_token);
  }

  private isUsableProvider(provider: Provider): boolean {
    const staticConfig = providers[provider.provider as ProviderType];
    if (!staticConfig) return this.hasSecretCredential(provider);
    if (staticConfig.authType === "none") return true;
    return this.hasSecretCredential(provider);
  }

  private pickPreferredProvider(
    candidates: Provider[],
    options?: { preferCredentialed?: boolean; requireUsable?: boolean }
  ): Provider | undefined {
    if (candidates.length === 0) return undefined;

    const requireUsable = options?.requireUsable !== false;
    const usable = requireUsable
      ? candidates.filter((candidate) => this.isUsableProvider(candidate))
      : candidates;
    if (usable.length === 0) return undefined;

    if (options?.preferCredentialed) {
      const defaultWithSecret = usable.find(
        (candidate) => !!candidate.is_default && this.hasSecretCredential(candidate)
      );
      if (defaultWithSecret) return this.mergeWithStaticConfig(defaultWithSecret);

      const anyWithSecret = usable.find((candidate) => this.hasSecretCredential(candidate));
      if (anyWithSecret) return this.mergeWithStaticConfig(anyWithSecret);
    }

    const defaultProvider = usable.find((candidate) => !!candidate.is_default);
    if (defaultProvider) return this.mergeWithStaticConfig(defaultProvider);

    return this.mergeWithStaticConfig(usable[0]);
  }

  list(): (Provider & { info?: (typeof providers)[ProviderType] })[] {
    const all = tables.providers.all() as Provider[];
    return all.map((p) => ({
      ...p,
      info: providers[p.provider as ProviderType],
      api_key: undefined,
      access_token: undefined,
      refresh_token: undefined,
    }));
  }

  get(id: string): Provider | undefined {
    const p = tables.providers.get(id);
    if (!p) return undefined;
    return {
      ...(p as Provider),
      api_key: undefined,
      access_token: undefined,
      refresh_token: undefined,
    };
  }

  getWithCredentials(id: string): Provider | undefined {
    const dbProvider = tables.providers.get(id) as Provider | undefined;
    if (!dbProvider) return undefined;
    return this.mergeWithStaticConfig(dbProvider);
  }

  // Dedupe concurrent refreshes per provider so parallel calls don't each
  // rotate the refresh_token and invalidate one another.
  private oauthRefreshInFlight = new Map<string, Promise<Provider | undefined>>();
  // Backoff for providers with unknown expiry whose refresh keeps failing, so
  // a broken token doesn't hit the token endpoint on every single call.
  private oauthRefreshCooldownUntil = new Map<string, number>();
  private static readonly OAUTH_REFRESH_COOLDOWN_MS = 60_000;

  /**
   * Refresh an OAuth provider's access_token when it's expired (or its expiry
   * is unknown) using the stored refresh_token. Returns the refreshed provider,
   * or undefined when no refresh is applicable/possible (caller keeps the
   * existing credentials). ChatGPT/Codex OAuth tokens are short-lived, so
   * without this every Codex call fails once the token lapses.
   */
  async refreshOAuthCredentialsIfNeeded(
    provider: Provider | undefined
  ): Promise<Provider | undefined> {
    if (!provider?.id) return undefined;
    const staticConfig = providers[provider.provider as ProviderType] as
      | { authType?: string; oauthConfig?: unknown }
      | undefined;
    if (!staticConfig || staticConfig.authType !== "oauth") return undefined;
    const oauth = staticConfig.oauthConfig as
      | { tokenUrl?: string; clientId?: string; clientSecret?: string; scope?: string }
      | undefined;
    if (!oauth?.tokenUrl || !oauth?.clientId) return undefined;
    if (!provider.refresh_token) return undefined;

    const now = Date.now();
    const skewMs = 120_000;
    const expiresAt = typeof provider.expires_at === "number" ? provider.expires_at : 0;
    // Refresh when expiry is unknown (never captured) or within the skew window.
    if (expiresAt > 0 && expiresAt - skewMs > now) return undefined;
    // When expiry is unknown, back off after a recent attempt so a broken
    // refresh doesn't hit the token endpoint on every call.
    if (expiresAt === 0) {
      const cooldownUntil = this.oauthRefreshCooldownUntil.get(provider.id) || 0;
      if (cooldownUntil > now) return undefined;
      this.oauthRefreshCooldownUntil.set(
        provider.id,
        now + ProviderManager.OAUTH_REFRESH_COOLDOWN_MS
      );
    }

    const existing = this.oauthRefreshInFlight.get(provider.id);
    if (existing) return existing;

    const task = this.performOAuthRefresh(provider, oauth).finally(() => {
      this.oauthRefreshInFlight.delete(provider.id);
    });
    this.oauthRefreshInFlight.set(provider.id, task);
    return task;
  }

  private async performOAuthRefresh(
    provider: Provider,
    oauth: { tokenUrl?: string; clientId?: string; clientSecret?: string; scope?: string }
  ): Promise<Provider | undefined> {
    try {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: provider.refresh_token || "",
        client_id: oauth.clientId || "",
      });
      if (oauth.clientSecret) params.set("client_secret", oauth.clientSecret);
      if (oauth.scope) params.set("scope", oauth.scope);

      const response = await fetch(oauth.tokenUrl || "", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params,
      });
      if (!response.ok) {
        // Keep the existing token; the call itself will surface a clear auth error.
        return undefined;
      }
      const data = (await response.json()) as {
        access_token?: unknown;
        refresh_token?: unknown;
        expires_in?: unknown;
      };
      const accessToken = typeof data.access_token === "string" ? data.access_token : "";
      if (!accessToken) return undefined;
      const expiresInMs =
        typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
          ? data.expires_in * 1000
          : 3_600_000;
      const nextRefresh =
        typeof data.refresh_token === "string" && data.refresh_token
          ? data.refresh_token
          : provider.refresh_token;

      // The update statement overwrites every column, so merge with the row.
      const current = tables.providers.get(provider.id) as Provider | undefined;
      if (!current) return undefined;
      tables.providers.update(provider.id, {
        ...current,
        access_token: accessToken,
        refresh_token: nextRefresh,
        expires_at: Date.now() + expiresInMs,
      });
      return this.getWithCredentials(provider.id);
    } catch {
      return undefined;
    }
  }

  getPreferredProvider(options?: {
    preferCredentialed?: boolean;
    requireUsable?: boolean;
  }): Provider | undefined {
    const allProviders = tables.providers.all() as Provider[];
    return this.pickPreferredProvider(allProviders, options);
  }

  resolveProviderId(value: string | undefined): string | undefined {
    if (!value || typeof value !== "string") return undefined;
    const input = value.trim();
    if (!input) return undefined;

    const direct = this.getWithCredentials(input);
    if (direct) return direct.id;

    const resolvedProviderType = resolveProviderType(input) ?? input;
    const byType = (tables.providers.all() as Provider[]).filter(
      (provider) => provider.provider === resolvedProviderType
    );
    const preferred = this.pickPreferredProvider(byType, {
      preferCredentialed: true,
      requireUsable: false,
    });
    return preferred?.id;
  }

  create(data: {
    provider: ProviderType;
    name: string;
    api_key?: string;
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    base_url?: string;
    is_default?: boolean;
  }): Provider {
    const id = crypto.randomUUID();
    const provider = providers[data.provider];

    tables.providers.create({
      id,
      provider: data.provider,
      name: data.name,
      base_url: data.base_url || provider?.baseUrl,
      api_key: data.api_key,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      is_default: data.is_default || false,
    });

    if (provider?.models) {
      for (const m of provider.models) {
        tables.providerModels.upsert({
          id: crypto.randomUUID(),
          provider_id: id,
          model_id: m.id,
          model_name: m.name,
          context_window: m.context,
          max_tokens: m.maxTokens,
          reasoning: m.reasoning,
          input_types: [...m.input],
        });
      }
    }

    return {
      id,
      provider: data.provider,
      name: data.name,
      base_url: data.base_url,
      is_default: data.is_default || false,
    };
  }

  update(id: string, data: Partial<Provider>): boolean {
    const existing = tables.providers.get(id);
    if (!existing) return false;

    const normalizedData: Partial<Provider> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        (normalizedData as Record<string, unknown>)[key] = value;
      }
    }

    if (typeof normalizedData.name === "string") {
      const trimmed = normalizedData.name.trim();
      if (trimmed) normalizedData.name = trimmed;
      else delete normalizedData.name;
    }

    if (typeof normalizedData.base_url === "string") {
      const trimmed = normalizedData.base_url.trim();
      if (trimmed) normalizedData.base_url = trimmed;
      else delete normalizedData.base_url;
    }

    for (const field of ["api_key", "access_token", "refresh_token"] as const) {
      const value = normalizedData[field];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          normalizedData[field] = trimmed;
        } else {
          delete normalizedData[field];
        }
      }
    }

    tables.providers.update(id, { ...(existing as Provider), ...normalizedData });
    this.authoritativeModelIds.delete(id);
    return true;
  }

  delete(id: string): boolean {
    this.authoritativeModelIds.delete(id);
    const result = tables.providers.delete(id);
    return result.changes > 0;
  }

  setAuthoritativeModels(providerId: string, modelIds: readonly string[]): void {
    const normalized = modelIds.map((id) => id.trim().toLowerCase()).filter(Boolean);
    if (normalized.length > 0) this.authoritativeModelIds.set(providerId, new Set(normalized));
  }

  private mergeStaticCatalogModels(providerId: string, cached: ProviderModel[]): ProviderModel[] {
    const providerRow = tables.providers.get(providerId) as Provider | undefined;
    if (!providerRow) return cached;

    const resolvedType = resolveProviderType(providerRow.provider);
    if (!resolvedType) return cached;

    const staticCatalog = providers[resolvedType]?.models;
    if (!staticCatalog || staticCatalog.length === 0) return cached;

    const cachedByModelId = new Map<string, ProviderModel>();
    for (const model of cached) {
      const key = model.model_id?.trim().toLowerCase();
      if (!key || cachedByModelId.has(key)) continue;
      cachedByModelId.set(key, model);
    }

    const merged: ProviderModel[] = [];
    const seen = new Set<string>();

    for (const model of staticCatalog) {
      const key = model.id.toLowerCase();
      const existing = cachedByModelId.get(key);
      if (existing) {
        merged.push({
          ...existing,
          model_name: existing.model_name || model.name,
          context_window: existing.context_window ?? model.context,
          max_tokens: existing.max_tokens ?? model.maxTokens,
          reasoning: existing.reasoning ?? model.reasoning,
        });
        seen.add(key);
        continue;
      }

      merged.push({
        id: `catalog:${providerId}:${model.id}`,
        provider_id: providerId,
        model_id: model.id,
        model_name: model.name,
        context_window: model.context,
        max_tokens: model.maxTokens,
        reasoning: model.reasoning,
        input_types: [...model.input],
      });
      seen.add(key);
    }

    for (const model of cached) {
      const key = model.model_id?.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      merged.push(model);
      seen.add(key);
    }

    return merged;
  }

  getModels(providerId: string): ProviderModel[] {
    const cached = tables.providerModels.byProvider(providerId) as ProviderModel[];
    const merged = this.mergeStaticCatalogModels(providerId, cached);
    const authoritative = this.authoritativeModelIds.get(providerId);
    return authoritative
      ? merged.filter((model) => authoritative.has(model.model_id.trim().toLowerCase()))
      : merged;
  }

  async discoverOllamaModels(): Promise<ProviderModel[]> {
    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      return (data.models || []).map((m: { name: string }) => ({
        id: crypto.randomUUID(),
        provider_id: "",
        model_id: m.name,
        model_name: m.name,
        context_window: 128000,
        max_tokens: 8192,
        reasoning: m.name.toLowerCase().includes("r1"),
        input_types: ["text"],
      }));
    } catch {
      return [];
    }
  }

  seedDefaults(): void {
    const existing = tables.providers.all() as Provider[];
    const existingProviders = new Set(existing.map((p) => p.provider));

    for (const [key, config] of Object.entries(providers)) {
      if (existingProviders.has(key)) continue;

      if (config.authType === "oauth" || config.authType === "api_key") continue;

      try {
        tables.providers.create({
          id: crypto.randomUUID(),
          provider: key,
          name: config.name,
          base_url: config.baseUrl,
          api_key: undefined,
          access_token: undefined,
          refresh_token: undefined,
          is_default: false,
        });
        console.log(`[ProviderManager] Seeded provider: ${config.name}`);
      } catch {
        // Ignore errors
      }
    }
  }

  getStats(): { total: number; withAuth: number } {
    const all = tables.providers.all() as Provider[];
    return {
      total: all.length,
      withAuth: all.filter((p) => p.api_key || p.access_token).length,
    };
  }
}

export const providerManager = new ProviderManager();

export function getProviderBaseUrl(providerType: string): string {
  const resolvedProviderType = resolveProviderType(providerType) ?? (providerType as ProviderType);
  const config = providers[resolvedProviderType];
  return config?.baseUrl || "https://api.openai.com/v1";
}

export function getDefaultModel(providerType: string): string {
  const defaults: Record<string, string> = {
    openai: "gpt-5.6-sol",
    meta: "muse-spark-1.1",
    elevenlabs: "eleven_multilingual_v2",
    anthropic: "claude-opus-4-8",
    minimax: "MiniMax-M3",
    "minimax-portal": "MiniMax-M3",
    google: "gemini-3.1-pro-preview",
    antigravity: "gemini-3.1-pro-preview",
    "google-antigravity": "gemini-3.1-pro-preview",
    "google-gemini-cli": "gemini-3.1-pro-preview",
    "gemini-cli": "gemini-3.1-pro-preview",
    groq: "llama-3.3-70b-versatile",
    openrouter: "anthropic/claude-opus-4-8",
    ollama: "llama3",
    "ollama-cloud": "glm-5.2:cloud",
    vllm: "Qwen/Qwen2.5-Coder-32B-Instruct",
    litellm: "gpt-4o",
    together: "moonshotai/Kimi-K2.6",
    huggingface: "moonshotai/Kimi-K2.6",
    "cloudflare-ai-gateway": "claude-sonnet-4-6",
    venice: "zai-org-glm-5",
    "z.ai": "glm-5.2",
    zai: "glm-5.2",
    "z.ai-coding": "glm-5.2",
    xiaomi: "mimo-v2.5-pro",
    opencode_zen: "claude-opus-4-8",
    opencode: "claude-opus-4-8",
    moonshot: "kimi-k2.6",
    "kimi-code": "kimi-for-coding",
    "kimi-coding": "kimi-for-coding",
    "qwen-portal": "coder-model",
    synthetic: "hf:zai-org/GLM-5",
    "openai-codex": "gpt-5.6-sol",
    chutes: "Qwen/Qwen3-32B-TEE",
    featherless: "Qwen/Qwen3-32B",
    longcat: "LongCat-2.0",
    github_copilot: "gpt-5.5",
    "github-copilot": "gpt-5.5",
    qianfan: "deepseek-v3.2",
    xai: "grok-4.3",
    "xai-oauth": "grok-build-0.1",
    "grok-oauth": "grok-build-0.1",
    "grok-build": "grok-build-0.1",
    nvidia: "nvidia/nemotron-3-super-120b-a12b",
    deepseek: "deepseek-v4-flash",
    alibaba: "qwen3.6-plus",
    "alibaba-coding-plan": "qwen3.6-plus",
    cerebras: "zai-glm-4.7",
    cohere: "command-a-03-2025",
    mistral: "devstral-medium-latest",
    deepinfra: "deepseek-ai/DeepSeek-V4-Flash",
    fireworks: "accounts/fireworks/models/kimi-k2p6",
    novita: "moonshotai/kimi-k2.5",
    stepfun: "step-3.5-flash",
    tencent: "hy3-preview",
    volcengine: "doubao-seed-1-8-251228",
    byteplus: "kimi-k2-5-260127",
    gmi: "zai-org/GLM-5.1-FP8",
    kilocode: "kilo/auto",
    "opencode-go": "deepseek-v4-pro",
    ds4: "deepseek-v4-flash",
    inferrs: "google/gemma-4-E2B-it",
  };
  const resolvedProviderType = resolveProviderType(providerType);
  if (resolvedProviderType) {
    return defaults[resolvedProviderType] || "gpt-4o";
  }
  const normalizedProviderType = providerType.trim().toLowerCase();
  return defaults[normalizedProviderType] || "gpt-4o";
}
