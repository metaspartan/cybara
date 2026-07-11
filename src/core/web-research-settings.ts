import { config } from "./config";
import { openSecret, sealSecret } from "./secret-storage";

const CONFIG_KEY = "web_research_credentials";
const MAX_SECRET_LENGTH = 8192;
const MAX_URL_LENGTH = 2048;

export const WEB_RESEARCH_CREDENTIAL_IDS = [
  "firecrawl",
  "parallel",
  "tavily",
  "exa",
  "brave",
] as const;

export type WebResearchCredentialId = (typeof WEB_RESEARCH_CREDENTIAL_IDS)[number];
export type WebResearchSettingSource = "env" | "stored" | "none";

interface StoredWebResearchSettings {
  credentials: Partial<Record<WebResearchCredentialId, string>>;
  firecrawlApiUrl?: string;
  searxngUrl?: string;
}

export interface WebResearchCredentialStatus {
  id: WebResearchCredentialId;
  label: string;
  envVar: string;
  configured: boolean;
  source: WebResearchSettingSource;
}

export interface WebResearchUrlStatus {
  value: string;
  source: WebResearchSettingSource;
  envVar: string;
}

export interface WebResearchSettingsStatus {
  credentials: WebResearchCredentialStatus[];
  firecrawlApiUrl: WebResearchUrlStatus;
  searxngUrl: WebResearchUrlStatus;
}

export interface WebResearchSettingsUpdate {
  credentials?: Partial<Record<WebResearchCredentialId, unknown>>;
  firecrawlApiUrl?: unknown;
  searxngUrl?: unknown;
}

const credentialDefinitions: Record<WebResearchCredentialId, { label: string; envVar: string }> = {
  firecrawl: { label: "Firecrawl", envVar: "FIRECRAWL_API_KEY" },
  parallel: { label: "Parallel", envVar: "PARALLEL_API_KEY" },
  tavily: { label: "Tavily", envVar: "TAVILY_API_KEY" },
  exa: { label: "Exa", envVar: "EXA_API_KEY" },
  brave: { label: "Brave Search", envVar: "BRAVE_API_KEY" },
};

function secretContext(id: WebResearchCredentialId): string {
  return `web-research:${id}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStoredSettings(): StoredWebResearchSettings {
  const value = config.get<unknown>(CONFIG_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { credentials: {} };
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
  return {
    credentials,
    firecrawlApiUrl: optionalString(record.firecrawlApiUrl),
    searxngUrl: optionalString(record.searxngUrl),
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

function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  return optionalString(env[name]);
}

function urlStatus(
  env: Record<string, string | undefined>,
  envNames: string[],
  storedValue: string | undefined
): WebResearchUrlStatus {
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

export function getWebResearchSettingsStatus(
  env: Record<string, string | undefined> = process.env
): WebResearchSettingsStatus {
  const stored = readStoredSettings();
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
    firecrawlApiUrl: urlStatus(env, ["FIRECRAWL_API_URL"], stored.firecrawlApiUrl),
    searxngUrl: urlStatus(env, ["SEARXNG_URL", "SEARXNG_BASE_URL"], stored.searxngUrl),
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
  if (!envValue(runtime, "FIRECRAWL_API_URL")) {
    runtime.FIRECRAWL_API_URL = stored.firecrawlApiUrl;
  }
  if (!envValue(runtime, "SEARXNG_URL") && !envValue(runtime, "SEARXNG_BASE_URL")) {
    runtime.SEARXNG_URL = stored.searxngUrl;
  }
  return runtime;
}

export function updateWebResearchSettings(
  input: WebResearchSettingsUpdate,
  env: Record<string, string | undefined> = process.env
): WebResearchSettingsStatus {
  const stored = readStoredSettings();
  const credentials = { ...stored.credentials };
  if (input.credentials !== undefined) {
    if (!input.credentials || typeof input.credentials !== "object") {
      throw new Error("Web research credentials must be an object");
    }
    for (const [rawId, value] of Object.entries(input.credentials)) {
      if (!WEB_RESEARCH_CREDENTIAL_IDS.includes(rawId as WebResearchCredentialId)) {
        throw new Error(`Unsupported web research credential: ${rawId}`);
      }
      const id = rawId as WebResearchCredentialId;
      const envVar = credentialDefinitions[id].envVar;
      if (envValue(env, envVar)) {
        throw new Error(`${envVar} is set in the gateway environment and cannot be changed here`);
      }
      const normalized = normalizeSecret(value);
      if (normalized) credentials[id] = sealSecret(normalized, secretContext(id));
      else delete credentials[id];
    }
  }

  let firecrawlApiUrl = stored.firecrawlApiUrl;
  if (input.firecrawlApiUrl !== undefined) {
    if (envValue(env, "FIRECRAWL_API_URL")) {
      throw new Error(
        "FIRECRAWL_API_URL is set in the gateway environment and cannot be changed here"
      );
    }
    firecrawlApiUrl = normalizeUrl(input.firecrawlApiUrl, "Firecrawl API URL");
  }

  let searxngUrl = stored.searxngUrl;
  if (input.searxngUrl !== undefined) {
    if (envValue(env, "SEARXNG_URL") || envValue(env, "SEARXNG_BASE_URL")) {
      throw new Error("SearXNG URL is set in the gateway environment and cannot be changed here");
    }
    searxngUrl = normalizeUrl(input.searxngUrl, "SearXNG URL");
  }

  config.set(CONFIG_KEY, { credentials, firecrawlApiUrl, searxngUrl });
  return getWebResearchSettingsStatus(env);
}
