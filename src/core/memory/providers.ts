import { isSealedSecret, openSecret, sealSecret } from "../secret-storage";

export type MemoryProviderId =
  | "local"
  | "supermemory"
  | "mem0"
  | "honcho"
  | "openviking"
  | "hindsight";

export const EXTERNAL_MEMORY_PROVIDER_IDS = [
  "supermemory",
  "mem0",
  "honcho",
  "openviking",
  "hindsight",
] as const;

export type ExternalMemoryProviderId = (typeof EXTERNAL_MEMORY_PROVIDER_IDS)[number];

export interface SupermemoryProviderSettings {
  apiKey: string;
  baseUrl: string;
  containerTag: string;
}

export interface Mem0ProviderSettings {
  apiKey: string;
  baseUrl: string;
  userId: string;
  agentId: string;
}

export interface HonchoProviderSettings {
  apiKey: string;
  baseUrl: string;
  workspace: string;
  peer: string;
}

export interface OpenVikingProviderSettings {
  apiKey: string;
  baseUrl: string;
}

export interface HindsightProviderSettings {
  apiKey: string;
  baseUrl: string;
  tenant: string;
  bankId: string;
}

export interface MemoryProviderSettings {
  provider: MemoryProviderId;
  autoRecall: boolean;
  autoCapture: boolean;
  supermemory: SupermemoryProviderSettings;
  mem0: Mem0ProviderSettings;
  honcho: HonchoProviderSettings;
  openviking: OpenVikingProviderSettings;
  hindsight: HindsightProviderSettings;
}

export interface ExternalMemoryResult {
  id?: string;
  content: string;
  score?: number;
}

export interface MemoryProviderHealth {
  ok: boolean;
  detail: string;
}

export interface MemoryProviderFieldSpec {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
}

export interface MemoryProviderAdapter {
  id: ExternalMemoryProviderId;
  label: string;
  docsUrl: string;
  fields: MemoryProviderFieldSpec[];
  isConfigured(settings: MemoryProviderSettings): boolean;
  store(
    settings: MemoryProviderSettings,
    content: string,
    metadata?: Record<string, string>
  ): Promise<void>;
  search(
    settings: MemoryProviderSettings,
    query: string,
    limit: number
  ): Promise<ExternalMemoryResult[]>;
  health(settings: MemoryProviderSettings): Promise<MemoryProviderHealth>;
}

export const REDACTED_SECRET_SENTINEL = "***redacted***";

export const DEFAULT_MEMORY_PROVIDER_SETTINGS: MemoryProviderSettings = {
  provider: "local",
  autoRecall: true,
  autoCapture: true,
  supermemory: { apiKey: "", baseUrl: "https://api.supermemory.ai", containerTag: "cybara" },
  mem0: { apiKey: "", baseUrl: "https://api.mem0.ai", userId: "cybara-user", agentId: "cybara" },
  honcho: { apiKey: "", baseUrl: "https://api.honcho.dev", workspace: "cybara", peer: "user" },
  openviking: { apiKey: "", baseUrl: "http://127.0.0.1:1933" },
  hindsight: {
    apiKey: "",
    baseUrl: "https://api.hindsight.vectorize.io",
    tenant: "default",
    bankId: "cybara",
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, fallback: string, maxLength = 400): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function readBaseUrl(value: unknown, fallback: string): string {
  const raw = readString(value, fallback);
  const trimmed = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return fallback;
  return trimmed;
}

export function normalizeMemoryProviderId(value: unknown): MemoryProviderId {
  if (typeof value !== "string") return "local";
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "" || normalized === "builtin") return "local";
  return (EXTERNAL_MEMORY_PROVIDER_IDS as readonly string[]).includes(normalized)
    ? (normalized as MemoryProviderId)
    : "local";
}

export function normalizeMemoryProviderSettings(value: unknown): MemoryProviderSettings {
  const record = asRecord(value);
  const defaults = DEFAULT_MEMORY_PROVIDER_SETTINGS;
  const supermemory = asRecord(record.supermemory);
  const mem0 = asRecord(record.mem0);
  const honcho = asRecord(record.honcho);
  const openviking = asRecord(record.openviking);
  const hindsight = asRecord(record.hindsight);
  return {
    provider: normalizeMemoryProviderId(record.provider),
    autoRecall: typeof record.autoRecall === "boolean" ? record.autoRecall : defaults.autoRecall,
    autoCapture:
      typeof record.autoCapture === "boolean" ? record.autoCapture : defaults.autoCapture,
    supermemory: {
      apiKey: readString(supermemory.apiKey, "", 4000),
      baseUrl: readBaseUrl(supermemory.baseUrl, defaults.supermemory.baseUrl),
      containerTag: readString(supermemory.containerTag, defaults.supermemory.containerTag, 120),
    },
    mem0: {
      apiKey: readString(mem0.apiKey, "", 4000),
      baseUrl: readBaseUrl(mem0.baseUrl, defaults.mem0.baseUrl),
      userId: readString(mem0.userId, defaults.mem0.userId, 120),
      agentId: readString(mem0.agentId, defaults.mem0.agentId, 120),
    },
    honcho: {
      apiKey: readString(honcho.apiKey, "", 4000),
      baseUrl: readBaseUrl(honcho.baseUrl, defaults.honcho.baseUrl),
      workspace: readString(honcho.workspace, defaults.honcho.workspace, 120),
      peer: readString(honcho.peer, defaults.honcho.peer, 120),
    },
    openviking: {
      apiKey: readString(openviking.apiKey, "", 4000),
      baseUrl: readBaseUrl(openviking.baseUrl, defaults.openviking.baseUrl),
    },
    hindsight: {
      apiKey: readString(hindsight.apiKey, "", 4000),
      baseUrl: readBaseUrl(hindsight.baseUrl, defaults.hindsight.baseUrl),
      tenant: readString(hindsight.tenant, defaults.hindsight.tenant, 120),
      bankId: readString(hindsight.bankId, defaults.hindsight.bankId, 120),
    },
  };
}

/** Replace stored secrets with a sentinel so API responses never leak keys. */
export function redactMemoryProviderSettings(
  settings: MemoryProviderSettings
): MemoryProviderSettings {
  const redact = (key: string): string => (key ? REDACTED_SECRET_SENTINEL : "");
  return {
    ...settings,
    supermemory: { ...settings.supermemory, apiKey: redact(settings.supermemory.apiKey) },
    mem0: { ...settings.mem0, apiKey: redact(settings.mem0.apiKey) },
    honcho: { ...settings.honcho, apiKey: redact(settings.honcho.apiKey) },
    openviking: { ...settings.openviking, apiKey: redact(settings.openviking.apiKey) },
    hindsight: { ...settings.hindsight, apiKey: redact(settings.hindsight.apiKey) },
  };
}

/** Merge an incoming (possibly redacted) update over stored settings, keeping
 *  existing secrets when the client echoes the redaction sentinel back. */
export function mergeMemoryProviderSettingsUpdate(
  stored: MemoryProviderSettings,
  update: unknown
): MemoryProviderSettings {
  const incoming = normalizeMemoryProviderSettings(update);
  const keepSecret = (next: string, previous: string): string =>
    next === REDACTED_SECRET_SENTINEL ? previous : next;
  return {
    ...incoming,
    supermemory: {
      ...incoming.supermemory,
      apiKey: keepSecret(incoming.supermemory.apiKey, stored.supermemory.apiKey),
    },
    mem0: { ...incoming.mem0, apiKey: keepSecret(incoming.mem0.apiKey, stored.mem0.apiKey) },
    honcho: {
      ...incoming.honcho,
      apiKey: keepSecret(incoming.honcho.apiKey, stored.honcho.apiKey),
    },
    openviking: {
      ...incoming.openviking,
      apiKey: keepSecret(incoming.openviking.apiKey, stored.openviking.apiKey),
    },
    hindsight: {
      ...incoming.hindsight,
      apiKey: keepSecret(incoming.hindsight.apiKey, stored.hindsight.apiKey),
    },
  };
}

function memoryProviderSecretContext(provider: ExternalMemoryProviderId): string {
  return `memory-provider:${provider}:api_key`;
}

function sealProviderKey(provider: ExternalMemoryProviderId, apiKey: string): string {
  return apiKey ? sealSecret(apiKey, memoryProviderSecretContext(provider)) : "";
}

function openProviderKey(provider: ExternalMemoryProviderId, apiKey: string): string {
  if (!apiKey) return "";
  try {
    return openSecret(apiKey, memoryProviderSecretContext(provider));
  } catch {
    return "";
  }
}

export function sealMemoryProviderSettings(
  settings: MemoryProviderSettings
): MemoryProviderSettings {
  return {
    ...settings,
    supermemory: {
      ...settings.supermemory,
      apiKey: sealProviderKey("supermemory", settings.supermemory.apiKey),
    },
    mem0: { ...settings.mem0, apiKey: sealProviderKey("mem0", settings.mem0.apiKey) },
    honcho: { ...settings.honcho, apiKey: sealProviderKey("honcho", settings.honcho.apiKey) },
    openviking: {
      ...settings.openviking,
      apiKey: sealProviderKey("openviking", settings.openviking.apiKey),
    },
    hindsight: {
      ...settings.hindsight,
      apiKey: sealProviderKey("hindsight", settings.hindsight.apiKey),
    },
  };
}

export function openMemoryProviderSettings(
  settings: MemoryProviderSettings
): MemoryProviderSettings {
  return {
    ...settings,
    supermemory: {
      ...settings.supermemory,
      apiKey: openProviderKey("supermemory", settings.supermemory.apiKey),
    },
    mem0: { ...settings.mem0, apiKey: openProviderKey("mem0", settings.mem0.apiKey) },
    honcho: { ...settings.honcho, apiKey: openProviderKey("honcho", settings.honcho.apiKey) },
    openviking: {
      ...settings.openviking,
      apiKey: openProviderKey("openviking", settings.openviking.apiKey),
    },
    hindsight: {
      ...settings.hindsight,
      apiKey: openProviderKey("hindsight", settings.hindsight.apiKey),
    },
  };
}

export function memoryProviderSettingsHavePlaintextSecrets(
  settings: MemoryProviderSettings
): boolean {
  return [
    settings.supermemory.apiKey,
    settings.mem0.apiKey,
    settings.honcho.apiKey,
    settings.openviking.apiKey,
    settings.hindsight.apiKey,
  ].some((key) => key !== "" && !isSealedSecret(key));
}

const REQUEST_TIMEOUT_MS = 10_000;

async function providerFetch(
  url: string,
  init: RequestInit & { headers: Record<string, string> }
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
}

function bearerHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

const supermemoryAdapter: MemoryProviderAdapter = {
  id: "supermemory",
  label: "Supermemory",
  docsUrl: "https://docs.supermemory.ai",
  fields: [
    { key: "apiKey", label: "API key", secret: true, required: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.supermemory.ai" },
    { key: "containerTag", label: "Container tag", placeholder: "cybara" },
  ],
  isConfigured: (s) => s.supermemory.apiKey.length > 0,
  store: async (s, content, metadata) => {
    const { apiKey, baseUrl, containerTag } = s.supermemory;
    const response = await providerFetch(`${baseUrl}/v3/documents`, {
      method: "POST",
      headers: bearerHeaders(apiKey),
      body: JSON.stringify({
        content,
        containerTag: containerTag || undefined,
        metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
      }),
    });
    if (!response.ok) throw new Error(await readErrorDetail(response));
  },
  search: async (s, query, limit) => {
    const { apiKey, baseUrl, containerTag } = s.supermemory;
    const response = await providerFetch(`${baseUrl}/v3/search`, {
      method: "POST",
      headers: bearerHeaders(apiKey),
      body: JSON.stringify({
        q: query,
        limit,
        containerTags: containerTag ? [containerTag] : undefined,
      }),
    });
    if (!response.ok) throw new Error(await readErrorDetail(response));
    const data = asRecord(await response.json());
    const results = Array.isArray(data.results) ? data.results : [];
    return results.flatMap((entry): ExternalMemoryResult[] => {
      const record = asRecord(entry);
      const chunks = Array.isArray(record.chunks) ? record.chunks : [];
      const chunkTexts = chunks
        .map((chunk) => readString(asRecord(chunk).content, "", 2000))
        .filter((text) => text.length > 0);
      const content =
        chunkTexts.join("\n") ||
        readString(record.summary, "", 2000) ||
        readString(record.content, "", 2000) ||
        readString(record.memory, "", 2000);
      if (!content) return [];
      return [
        {
          id: readString(record.documentId ?? record.id, "", 200) || undefined,
          content,
          score: typeof record.score === "number" ? record.score : undefined,
        },
      ];
    });
  },
  health: async (s) => {
    try {
      const results = await supermemoryAdapter.search(s, "connection check", 1);
      return { ok: true, detail: `Search reachable (${results.length} results)` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Request failed" };
    }
  },
};

const mem0Adapter: MemoryProviderAdapter = {
  id: "mem0",
  label: "Mem0",
  docsUrl: "https://docs.mem0.ai",
  fields: [
    { key: "apiKey", label: "API key", secret: true, required: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.mem0.ai" },
    { key: "userId", label: "User ID", placeholder: "cybara-user" },
    { key: "agentId", label: "Agent ID", placeholder: "cybara" },
  ],
  isConfigured: (s) => s.mem0.apiKey.length > 0,
  store: async (s, content, metadata) => {
    const { apiKey, baseUrl, userId, agentId } = s.mem0;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Token ${apiKey}`;
    const response = await providerFetch(`${baseUrl}/v1/memories/`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [{ role: "user", content }],
        user_id: userId,
        agent_id: agentId || undefined,
        metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
        infer: false,
      }),
    });
    if (!response.ok) throw new Error(await readErrorDetail(response));
  },
  search: async (s, query, limit) => {
    const { apiKey, baseUrl, userId } = s.mem0;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Token ${apiKey}`;
    const response = await providerFetch(`${baseUrl}/v1/memories/search/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, user_id: userId, limit }),
    });
    if (!response.ok) throw new Error(await readErrorDetail(response));
    const data = await response.json();
    const results = Array.isArray(data)
      ? data
      : Array.isArray(asRecord(data).results)
        ? (asRecord(data).results as unknown[])
        : [];
    return results.flatMap((entry): ExternalMemoryResult[] => {
      const record = asRecord(entry);
      const content = readString(record.memory ?? record.text ?? record.content, "", 2000);
      if (!content) return [];
      return [
        {
          id: readString(record.id, "", 200) || undefined,
          content,
          score: typeof record.score === "number" ? record.score : undefined,
        },
      ];
    });
  },
  health: async (s) => {
    const { apiKey, baseUrl, userId } = s.mem0;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Token ${apiKey}`;
    try {
      const response = await providerFetch(
        `${baseUrl}/v1/memories/?user_id=${encodeURIComponent(userId)}&page_size=1`,
        { method: "GET", headers }
      );
      if (!response.ok) return { ok: false, detail: await readErrorDetail(response) };
      return { ok: true, detail: "Memories endpoint reachable" };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Request failed" };
    }
  },
};

const honchoAdapter: MemoryProviderAdapter = {
  id: "honcho",
  label: "Honcho",
  docsUrl: "https://docs.honcho.dev",
  fields: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.honcho.dev" },
    { key: "workspace", label: "Workspace", placeholder: "cybara" },
    { key: "peer", label: "Peer", placeholder: "user" },
  ],
  isConfigured: (s) => s.honcho.apiKey.length > 0 || !s.honcho.baseUrl.includes("api.honcho.dev"),
  store: async (s, content, metadata) => {
    const { apiKey, baseUrl, workspace, peer } = s.honcho;
    const response = await providerFetch(
      `${baseUrl}/v2/workspaces/${encodeURIComponent(workspace)}/peers/${encodeURIComponent(peer)}/messages`,
      {
        method: "POST",
        headers: bearerHeaders(apiKey),
        body: JSON.stringify({
          messages: [
            {
              content,
              metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
            },
          ],
        }),
      }
    );
    if (!response.ok) throw new Error(await readErrorDetail(response));
  },
  search: async (s, query, _limit) => {
    const { apiKey, baseUrl, workspace, peer } = s.honcho;
    const response = await providerFetch(
      `${baseUrl}/v2/workspaces/${encodeURIComponent(workspace)}/peers/${encodeURIComponent(peer)}/chat`,
      {
        method: "POST",
        headers: bearerHeaders(apiKey),
        body: JSON.stringify({ query }),
      }
    );
    if (!response.ok) throw new Error(await readErrorDetail(response));
    const data = asRecord(await response.json());
    const content = readString(data.content ?? data.response ?? data.answer, "", 4000);
    return content ? [{ content }] : [];
  },
  health: async (s) => {
    const { apiKey, baseUrl } = s.honcho;
    try {
      const origin = new URL(baseUrl).origin;
      const response = await providerFetch(`${origin}/health`, {
        method: "GET",
        headers: bearerHeaders(apiKey),
      });
      if (response.ok) return { ok: true, detail: "Server healthy" };
      return { ok: false, detail: await readErrorDetail(response) };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Request failed" };
    }
  },
};

const openvikingAdapter: MemoryProviderAdapter = {
  id: "openviking",
  label: "OpenViking",
  docsUrl: "https://github.com/volcengine/OpenViking",
  fields: [
    { key: "baseUrl", label: "Server URL", required: true, placeholder: "http://127.0.0.1:1933" },
    { key: "apiKey", label: "API key", secret: true },
  ],
  isConfigured: (s) => s.openviking.baseUrl.length > 0,
  store: async (s, content, metadata) => {
    const { apiKey, baseUrl } = s.openviking;
    const category = metadata?.category || "fact";
    const response = await providerFetch(`${baseUrl}/api/v1/content/write`, {
      method: "POST",
      headers: bearerHeaders(apiKey),
      body: JSON.stringify({
        uri: `viking://user/memories/${category}/${Date.now().toString(36)}.md`,
        content,
      }),
    });
    if (!response.ok) throw new Error(await readErrorDetail(response));
  },
  search: async (s, query, limit) => {
    const { apiKey, baseUrl } = s.openviking;
    const response = await providerFetch(`${baseUrl}/api/v1/search/find`, {
      method: "POST",
      headers: bearerHeaders(apiKey),
      body: JSON.stringify({ query, limit }),
    });
    if (!response.ok) throw new Error(await readErrorDetail(response));
    const data = asRecord(await response.json());
    const result = asRecord(data.result);
    const entries = Array.isArray(result.items)
      ? result.items
      : Array.isArray(data.results)
        ? (data.results as unknown[])
        : [];
    return entries.flatMap((entry): ExternalMemoryResult[] => {
      const record = asRecord(entry);
      const content = readString(record.abstract ?? record.content ?? record.text, "", 2000);
      if (!content) return [];
      return [
        {
          id: readString(record.uri ?? record.id, "", 300) || undefined,
          content,
          score: typeof record.score === "number" ? record.score : undefined,
        },
      ];
    });
  },
  health: async (s) => {
    const { apiKey, baseUrl } = s.openviking;
    try {
      const response = await providerFetch(`${baseUrl}/health`, {
        method: "GET",
        headers: bearerHeaders(apiKey),
      });
      if (response.ok) return { ok: true, detail: "Server healthy" };
      return { ok: false, detail: await readErrorDetail(response) };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Request failed" };
    }
  },
};

const hindsightAdapter: MemoryProviderAdapter = {
  id: "hindsight",
  label: "Hindsight",
  docsUrl: "https://hindsight.vectorize.io",
  fields: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.hindsight.vectorize.io" },
    { key: "tenant", label: "Tenant", placeholder: "default" },
    { key: "bankId", label: "Memory bank", placeholder: "cybara" },
  ],
  isConfigured: (s) =>
    s.hindsight.apiKey.length > 0 || !s.hindsight.baseUrl.includes("vectorize.io"),
  store: async (s, content, metadata) => {
    const { apiKey, baseUrl, tenant, bankId } = s.hindsight;
    const response = await providerFetch(
      `${baseUrl}/v1/${encodeURIComponent(tenant)}/banks/${encodeURIComponent(bankId)}/memories`,
      {
        method: "POST",
        headers: bearerHeaders(apiKey),
        body: JSON.stringify({
          items: [
            {
              content,
              metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
            },
          ],
        }),
      }
    );
    if (!response.ok) throw new Error(await readErrorDetail(response));
  },
  search: async (s, query, limit) => {
    const { apiKey, baseUrl, tenant, bankId } = s.hindsight;
    const response = await providerFetch(
      `${baseUrl}/v1/${encodeURIComponent(tenant)}/banks/${encodeURIComponent(bankId)}/memories/recall`,
      {
        method: "POST",
        headers: bearerHeaders(apiKey),
        body: JSON.stringify({ query, max_results: limit }),
      }
    );
    if (!response.ok) throw new Error(await readErrorDetail(response));
    const data = asRecord(await response.json());
    const results = Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.memories)
        ? (data.memories as unknown[])
        : [];
    return results.flatMap((entry): ExternalMemoryResult[] => {
      const record = asRecord(entry);
      const content = readString(record.text ?? record.content ?? record.memory, "", 2000);
      if (!content) return [];
      return [
        {
          id: readString(record.id, "", 200) || undefined,
          content,
          score: typeof record.score === "number" ? record.score : undefined,
        },
      ];
    });
  },
  health: async (s) => {
    const { apiKey, baseUrl } = s.hindsight;
    try {
      const response = await providerFetch(`${baseUrl}/version`, {
        method: "GET",
        headers: bearerHeaders(apiKey),
      });
      if (response.ok) return { ok: true, detail: "Server reachable" };
      return { ok: false, detail: await readErrorDetail(response) };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Request failed" };
    }
  },
};

export const MEMORY_PROVIDER_ADAPTERS: Record<ExternalMemoryProviderId, MemoryProviderAdapter> = {
  supermemory: supermemoryAdapter,
  mem0: mem0Adapter,
  honcho: honchoAdapter,
  openviking: openvikingAdapter,
  hindsight: hindsightAdapter,
};

export function getMemoryProviderAdapter(id: MemoryProviderId): MemoryProviderAdapter | undefined {
  if (id === "local") return undefined;
  return MEMORY_PROVIDER_ADAPTERS[id];
}

export function getActiveMemoryProviderAdapter(
  settings: MemoryProviderSettings
): MemoryProviderAdapter | undefined {
  const adapter = getMemoryProviderAdapter(settings.provider);
  if (!adapter || !adapter.isConfigured(settings)) return undefined;
  return adapter;
}

export interface MemoryProviderCatalogEntry {
  id: MemoryProviderId;
  label: string;
  docsUrl: string;
  fields: MemoryProviderFieldSpec[];
  configured: boolean;
  active: boolean;
}

export function getMemoryProviderCatalog(
  settings: MemoryProviderSettings
): MemoryProviderCatalogEntry[] {
  const local: MemoryProviderCatalogEntry = {
    id: "local",
    label: "Built-in (local)",
    docsUrl: "",
    fields: [],
    configured: true,
    active: settings.provider === "local",
  };
  const external = EXTERNAL_MEMORY_PROVIDER_IDS.map((id) => {
    const adapter = MEMORY_PROVIDER_ADAPTERS[id];
    return {
      id: adapter.id as MemoryProviderId,
      label: adapter.label,
      docsUrl: adapter.docsUrl,
      fields: adapter.fields,
      configured: adapter.isConfigured(settings),
      active: settings.provider === id && adapter.isConfigured(settings),
    };
  });
  return [local, ...external];
}

export async function testMemoryProvider(
  id: MemoryProviderId,
  settings: MemoryProviderSettings
): Promise<MemoryProviderHealth> {
  if (id === "local") return { ok: true, detail: "Built-in memory is always available" };
  const adapter = getMemoryProviderAdapter(id);
  if (!adapter) return { ok: false, detail: `Unknown provider: ${id}` };
  if (!adapter.isConfigured(settings)) {
    return { ok: false, detail: `${adapter.label} is not configured yet` };
  }
  return adapter.health(settings);
}

/** Mirror a durable memory write to the active external provider. Never throws;
 *  external memory is best-effort alongside the local source of truth. */
export async function captureToExternalMemory(
  settings: MemoryProviderSettings,
  content: string,
  metadata?: Record<string, string>
): Promise<boolean> {
  if (!settings.autoCapture) return false;
  const adapter = getActiveMemoryProviderAdapter(settings);
  if (!adapter) return false;
  try {
    await adapter.store(settings, content, metadata);
    return true;
  } catch (error) {
    console.warn(
      `[Memory] ${adapter.label} capture failed:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

/** Recall from the active external provider. Never throws. */
export async function recallFromExternalMemory(
  settings: MemoryProviderSettings,
  query: string,
  limit = 5
): Promise<ExternalMemoryResult[]> {
  if (!settings.autoRecall) return [];
  const adapter = getActiveMemoryProviderAdapter(settings);
  if (!adapter) return [];
  try {
    return await adapter.search(settings, query, limit);
  } catch (error) {
    console.warn(
      `[Memory] ${adapter.label} recall failed:`,
      error instanceof Error ? error.message : error
    );
    return [];
  }
}
