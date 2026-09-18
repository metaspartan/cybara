import { config } from "./config";
import { openSecret, sealSecret } from "./secret-storage";
import {
  backendIsConfigured,
  disabledSearchBackends,
  isWebSearchBackend,
  orderedSearchBackends,
  WEB_SEARCH_BACKEND_LABELS,
  WEB_SEARCH_DISABLED_ENV,
  WEB_SEARCH_MCP_COUNT_ARG_ENV,
  WEB_SEARCH_MCP_QUERY_ARG_ENV,
  WEB_SEARCH_MCP_SERVER_ENV,
  WEB_SEARCH_MCP_TOOL_ENV,
  WEB_SEARCH_ORDER_ENV,
  type WebSearchBackend,
} from "./tools/handlers/web-search-backends";

const CONFIG_KEY = "web_research_credentials";
const MAX_SECRET_LENGTH = 8192;
const MAX_URL_LENGTH = 2048;
const MAX_MCP_FIELD_LENGTH = 256;

export const WEB_RESEARCH_CREDENTIAL_IDS = [
  "firecrawl",
  "parallel",
  "tavily",
  "exa",
  "brave",
] as const;

export const WEB_RESEARCH_URL_IDS = [
  "firecrawl",
  "parallel",
  "tavily",
  "exa",
  "brave",
  "searxng",
] as const;

export type WebResearchCredentialId = (typeof WEB_RESEARCH_CREDENTIAL_IDS)[number];
export type WebResearchUrlId = (typeof WEB_RESEARCH_URL_IDS)[number];
export type WebResearchSettingSource = "env" | "stored" | "none";

interface StoredMcpBackend {
  server: string;
  tool: string;
  queryArg?: string;
  countArg?: string;
}

interface StoredWebResearchSettings {
  credentials: Partial<Record<WebResearchCredentialId, string>>;
  urls: Partial<Record<WebResearchUrlId, string>>;
  backendOrder?: WebSearchBackend[];
  disabledBackends?: WebSearchBackend[];
  mcpBackend?: StoredMcpBackend;
}

export interface WebResearchCredentialStatus {
  id: WebResearchCredentialId;
  label: string;
  envVar: string;
  configured: boolean;
  source: WebResearchSettingSource;
}

export interface WebResearchUrlStatus {
  id: WebResearchUrlId;
  label: string;
  value: string;
  placeholder: string;
  source: WebResearchSettingSource;
  envVar: string;
}

export interface WebSearchBackendStatus {
  id: WebSearchBackend;
  label: string;
  configured: boolean;
  enabled: boolean;
}

export interface WebSearchMcpBackendStatus {
  server: string;
  tool: string;
  queryArg: string;
  countArg: string;
  source: WebResearchSettingSource;
}

export interface WebResearchSettingsStatus {
  credentials: WebResearchCredentialStatus[];
  urls: WebResearchUrlStatus[];
  backends: WebSearchBackendStatus[];
  backendOrderSource: WebResearchSettingSource;
  disabledBackendsSource: WebResearchSettingSource;
  mcpBackend: WebSearchMcpBackendStatus;
}

export interface WebResearchSettingsUpdate {
  credentials?: Partial<Record<WebResearchCredentialId, unknown>>;
  urls?: Partial<Record<WebResearchUrlId, unknown>>;
  backendOrder?: unknown;
  disabledBackends?: unknown;
  mcpBackend?: unknown;
}

const credentialDefinitions: Record<WebResearchCredentialId, { label: string; envVar: string }> = {
  firecrawl: { label: "Firecrawl", envVar: "FIRECRAWL_API_KEY" },
  parallel: { label: "Parallel", envVar: "PARALLEL_API_KEY" },
  tavily: { label: "Tavily", envVar: "TAVILY_API_KEY" },
  exa: { label: "Exa", envVar: "EXA_API_KEY" },
  brave: { label: "Brave Search", envVar: "BRAVE_API_KEY" },
};

const urlDefinitions: Record<
  WebResearchUrlId,
  { label: string; envVars: string[]; placeholder: string }
> = {
  firecrawl: {
    label: "Firecrawl API URL",
    envVars: ["FIRECRAWL_API_URL"],
    placeholder: "https://api.firecrawl.dev",
  },
  parallel: {
    label: "Parallel base URL",
    envVars: ["PARALLEL_API_URL"],
    placeholder: "https://api.parallel.ai",
  },
  tavily: {
    label: "Tavily base URL",
    envVars: ["TAVILY_API_URL"],
    placeholder: "https://api.tavily.com",
  },
  exa: { label: "Exa base URL", envVars: ["EXA_API_URL"], placeholder: "https://api.exa.ai" },
  brave: {
    label: "Brave Search base URL",
    envVars: ["BRAVE_API_URL"],
    placeholder: "https://api.search.brave.com",
  },
  searxng: {
    label: "SearXNG URL",
    envVars: ["SEARXNG_URL", "SEARXNG_BASE_URL"],
    placeholder: "http://localhost:8080",
  },
};

const MCP_ENV_VARS = [
  WEB_SEARCH_MCP_SERVER_ENV,
  WEB_SEARCH_MCP_TOOL_ENV,
  WEB_SEARCH_MCP_QUERY_ARG_ENV,
  WEB_SEARCH_MCP_COUNT_ARG_ENV,
];

function secretContext(id: WebResearchCredentialId): string {
  return `web-research:${id}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStoredSettings(): StoredWebResearchSettings {
  const value = config.get<unknown>(CONFIG_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { credentials: {}, urls: {} };
  }
  const record = value as Record<string, unknown>;
  const rawCredentials =
    record.credentials &&
    typeof record.credentials === "object" &&
    !Array.isArray(record.credentials)
      ? (record.credentials as Record<string, unknown>)
      : {};
  const credentials: Partial<Record<WebResearchCredentialId, string>> = {};
  for (const id of WEB_RESEARCH_CREDENTIAL_IDS) {
    const secret = optionalString(rawCredentials[id]);
    if (secret) credentials[id] = secret;
  }
  const rawUrls = isPlainRecord(record.urls) ? record.urls : {};
  const legacyUrls: Partial<Record<WebResearchUrlId, unknown>> = {
    firecrawl: record.firecrawlApiUrl,
    searxng: record.searxngUrl,
  };
  const urls: Partial<Record<WebResearchUrlId, string>> = {};
  for (const id of WEB_RESEARCH_URL_IDS) {
    const url = optionalString(rawUrls[id]) ?? optionalString(legacyUrls[id]);
    if (url) urls[id] = url;
  }
  return {
    credentials,
    urls,
    backendOrder: storedBackendList(record.backendOrder),
    disabledBackends: storedBackendList(record.disabledBackends),
    mcpBackend: storedMcpBackend(record.mcpBackend),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function storedBackendList(value: unknown): WebSearchBackend[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter(isWebSearchBackend))];
}

function storedMcpBackend(value: unknown): StoredMcpBackend | undefined {
  if (!isPlainRecord(value)) return undefined;
  const server = optionalString(value.server);
  const tool = optionalString(value.tool);
  if (!server || !tool) return undefined;
  return {
    server,
    tool,
    queryArg: optionalString(value.queryArg),
    countArg: optionalString(value.countArg),
  };
}

function openStoredCredential(
  stored: StoredWebResearchSettings,
  id: WebResearchCredentialId
): string | undefined {
  const secret = stored.credentials[id];
  if (!secret) return undefined;
  try {
    return openSecret(secret, secretContext(id)).trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizeSecret(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Web research API keys must be strings");
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_SECRET_LENGTH) {
    throw new Error(`Web research API keys must be ${MAX_SECRET_LENGTH} characters or fewer`);
  }
  return normalized;
}

function normalizeUrl(value: unknown, label: string): string | undefined {
  if (value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > MAX_URL_LENGTH) {
    throw new Error(`${label} must be ${MAX_URL_LENGTH} characters or fewer`);
  }
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} cannot contain credentials`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function normalizeBackendList(value: unknown, label: string): WebSearchBackend[] | undefined {
  if (value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const item of value) {
    if (!isWebSearchBackend(item))
      throw new Error(`Unsupported web search backend: ${String(item)}`);
  }
  return [...new Set(value as WebSearchBackend[])];
}

function normalizeMcpField(value: unknown, label: string, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${label} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized && required) throw new Error(`${label} is required`);
  if (normalized.length > MAX_MCP_FIELD_LENGTH) {
    throw new Error(`${label} must be ${MAX_MCP_FIELD_LENGTH} characters or fewer`);
  }
  return normalized || undefined;
}

function normalizeMcpBackend(value: unknown): StoredMcpBackend | undefined {
  if (value === null) return undefined;
  if (!isPlainRecord(value)) throw new Error("MCP search backend must be an object");
  const server = normalizeMcpField(value.server, "MCP search server", false);
  const tool = normalizeMcpField(value.tool, "MCP search tool", false);
  if (!server && !tool) return undefined;
  if (!server || !tool) throw new Error("MCP search backend needs both a server and a tool");
  return {
    server,
    tool,
    queryArg: normalizeMcpField(value.queryArg, "MCP query argument", false),
    countArg: normalizeMcpField(value.countArg, "MCP count argument", false),
  };
}

function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  return optionalString(env[name]);
}

function urlStatus(
  env: Record<string, string | undefined>,
  envNames: string[],
  storedValue: string | undefined
): Pick<WebResearchUrlStatus, "value" | "source" | "envVar"> {
  for (const envVar of envNames) {
    const value = envValue(env, envVar);
    if (value) return { value, source: "env", envVar };
  }
  return {
    value: storedValue || "",
    source: storedValue ? "stored" : "none",
    envVar: envNames.join(" or "),
  };
}

function anyEnvValue(env: Record<string, string | undefined>, names: string[]): boolean {
  return names.some((name) => Boolean(envValue(env, name)));
}

function listSource(
  env: Record<string, string | undefined>,
  envVar: string,
  storedValue: WebSearchBackend[] | undefined
): WebResearchSettingSource {
  if (envValue(env, envVar)) return "env";
  return storedValue ? "stored" : "none";
}

function mcpBackendStatus(
  env: Record<string, string | undefined>,
  runtime: Record<string, string | undefined>,
  stored: StoredWebResearchSettings
): WebSearchMcpBackendStatus {
  return {
    server: runtime[WEB_SEARCH_MCP_SERVER_ENV] ?? "",
    tool: runtime[WEB_SEARCH_MCP_TOOL_ENV] ?? "",
    queryArg: runtime[WEB_SEARCH_MCP_QUERY_ARG_ENV] ?? "",
    countArg: runtime[WEB_SEARCH_MCP_COUNT_ARG_ENV] ?? "",
    source: anyEnvValue(env, MCP_ENV_VARS) ? "env" : stored.mcpBackend ? "stored" : "none",
  };
}

export function getWebResearchSettingsStatus(
  env: Record<string, string | undefined> = process.env
): WebResearchSettingsStatus {
  const stored = readStoredSettings();
  const runtime = getWebResearchRuntimeEnv(env);
  const disabled = disabledSearchBackends(runtime);
  return {
    credentials: WEB_RESEARCH_CREDENTIAL_IDS.map((id) => {
      const definition = credentialDefinitions[id];
      const environmentSecret = envValue(env, definition.envVar);
      const storedSecret = openStoredCredential(stored, id);
      return {
        id,
        label: definition.label,
        envVar: definition.envVar,
        configured: Boolean(environmentSecret || storedSecret),
        source: environmentSecret ? "env" : storedSecret ? "stored" : "none",
      };
    }),
    urls: WEB_RESEARCH_URL_IDS.map((id) => ({
      id,
      label: urlDefinitions[id].label,
      placeholder: urlDefinitions[id].placeholder,
      ...urlStatus(env, urlDefinitions[id].envVars, stored.urls[id]),
    })),
    backends: orderedSearchBackends(runtime).map((id) => ({
      id,
      label: WEB_SEARCH_BACKEND_LABELS[id],
      configured: backendIsConfigured(id, runtime),
      enabled: !disabled.includes(id),
    })),
    backendOrderSource: listSource(env, WEB_SEARCH_ORDER_ENV, stored.backendOrder),
    disabledBackendsSource: listSource(env, WEB_SEARCH_DISABLED_ENV, stored.disabledBackends),
    mcpBackend: mcpBackendStatus(env, runtime, stored),
  };
}

export function getWebResearchRuntimeEnv(
  env: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  const runtime = { ...env };
  const stored = readStoredSettings();
  for (const id of WEB_RESEARCH_CREDENTIAL_IDS) {
    const envVar = credentialDefinitions[id].envVar;
    if (!envValue(runtime, envVar)) runtime[envVar] = openStoredCredential(stored, id);
  }
  for (const id of WEB_RESEARCH_URL_IDS) {
    const envVars = urlDefinitions[id].envVars;
    if (!anyEnvValue(runtime, envVars)) runtime[envVars[0]] = stored.urls[id];
  }
  if (!envValue(runtime, WEB_SEARCH_ORDER_ENV) && stored.backendOrder) {
    runtime[WEB_SEARCH_ORDER_ENV] = stored.backendOrder.join(",");
  }
  if (!envValue(runtime, WEB_SEARCH_DISABLED_ENV) && stored.disabledBackends) {
    runtime[WEB_SEARCH_DISABLED_ENV] = stored.disabledBackends.join(",");
  }
  if (!anyEnvValue(runtime, MCP_ENV_VARS) && stored.mcpBackend) {
    runtime[WEB_SEARCH_MCP_SERVER_ENV] = stored.mcpBackend.server;
    runtime[WEB_SEARCH_MCP_TOOL_ENV] = stored.mcpBackend.tool;
    runtime[WEB_SEARCH_MCP_QUERY_ARG_ENV] = stored.mcpBackend.queryArg;
    runtime[WEB_SEARCH_MCP_COUNT_ARG_ENV] = stored.mcpBackend.countArg;
  }
  return runtime;
}

function assertNotEnvLocked(
  env: Record<string, string | undefined>,
  envVars: string[],
  label: string
): void {
  if (anyEnvValue(env, envVars)) {
    throw new Error(`${label} is set in the gateway environment and cannot be changed here`);
  }
}

export function updateWebResearchSettings(
  input: WebResearchSettingsUpdate,
  env: Record<string, string | undefined> = process.env
): WebResearchSettingsStatus {
  const stored = readStoredSettings();
  const credentials = { ...stored.credentials };
  if (input.credentials !== undefined) {
    if (!isPlainRecord(input.credentials)) {
      throw new Error("Web research credentials must be an object");
    }
    for (const [rawId, value] of Object.entries(input.credentials)) {
      if (!WEB_RESEARCH_CREDENTIAL_IDS.includes(rawId as WebResearchCredentialId)) {
        throw new Error(`Unsupported web research credential: ${rawId}`);
      }
      const id = rawId as WebResearchCredentialId;
      const envVar = credentialDefinitions[id].envVar;
      assertNotEnvLocked(env, [envVar], envVar);
      const normalized = normalizeSecret(value);
      if (normalized) credentials[id] = sealSecret(normalized, secretContext(id));
      else delete credentials[id];
    }
  }

  const urls = { ...stored.urls };
  if (input.urls !== undefined) {
    if (!isPlainRecord(input.urls)) throw new Error("Web research URLs must be an object");
    for (const [rawId, value] of Object.entries(input.urls)) {
      if (!WEB_RESEARCH_URL_IDS.includes(rawId as WebResearchUrlId)) {
        throw new Error(`Unsupported web research URL: ${rawId}`);
      }
      const id = rawId as WebResearchUrlId;
      const definition = urlDefinitions[id];
      assertNotEnvLocked(env, definition.envVars, definition.label);
      const normalized = normalizeUrl(value, definition.label);
      if (normalized) urls[id] = normalized;
      else delete urls[id];
    }
  }

  let backendOrder = stored.backendOrder;
  if (input.backendOrder !== undefined) {
    assertNotEnvLocked(env, [WEB_SEARCH_ORDER_ENV], "Web search order");
    backendOrder = normalizeBackendList(input.backendOrder, "Web search order");
  }

  let disabledBackends = stored.disabledBackends;
  if (input.disabledBackends !== undefined) {
    assertNotEnvLocked(env, [WEB_SEARCH_DISABLED_ENV], "Disabled web search backends");
    disabledBackends = normalizeBackendList(input.disabledBackends, "Disabled web search backends");
  }

  let mcpBackend = stored.mcpBackend;
  if (input.mcpBackend !== undefined) {
    assertNotEnvLocked(env, MCP_ENV_VARS, "MCP search backend");
    mcpBackend = normalizeMcpBackend(input.mcpBackend);
  }

  config.set(CONFIG_KEY, { credentials, urls, backendOrder, disabledBackends, mcpBackend });
  return getWebResearchSettingsStatus(env);
}
