import { config } from "./config";
import { openSecret, sealSecret } from "./secret-storage";

const CONFIG_KEY = "integration_credentials";
const MAX_SECRET_LENGTH = 8192;

export const INTEGRATION_CREDENTIAL_IDS = ["smithery", "voyage"] as const;

export type IntegrationCredentialId = (typeof INTEGRATION_CREDENTIAL_IDS)[number];
export type IntegrationCredentialSource = "env" | "stored" | "none";

interface StoredIntegrationCredentials {
  credentials: Partial<Record<IntegrationCredentialId, string>>;
}

export interface IntegrationCredentialStatus {
  id: IntegrationCredentialId;
  label: string;
  envVar: string;
  configured: boolean;
  source: IntegrationCredentialSource;
}

export interface IntegrationCredentialsStatus {
  credentials: IntegrationCredentialStatus[];
}

export interface IntegrationCredentialsUpdate {
  credentials?: Partial<Record<IntegrationCredentialId, unknown>>;
}

const definitions: Record<IntegrationCredentialId, { label: string; envVar: string }> = {
  smithery: { label: "Smithery", envVar: "SMITHERY_API_KEY" },
  voyage: { label: "Voyage AI", envVar: "VOYAGE_API_KEY" },
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function secretContext(id: IntegrationCredentialId): string {
  return `integration:${id}`;
}

function readStoredCredentials(): StoredIntegrationCredentials {
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
  const credentials: Partial<Record<IntegrationCredentialId, string>> = {};
  for (const id of INTEGRATION_CREDENTIAL_IDS) {
    const secret = optionalString(rawCredentials[id]);
    if (secret) credentials[id] = secret;
  }
  return { credentials };
}

function openStoredCredential(
  stored: StoredIntegrationCredentials,
  id: IntegrationCredentialId
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
  if (typeof value !== "string") throw new Error("Integration API keys must be strings");
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_SECRET_LENGTH) {
    throw new Error(`Integration API keys must be ${MAX_SECRET_LENGTH} characters or fewer`);
  }
  return normalized;
}

function environmentCredential(
  id: IntegrationCredentialId,
  env: Record<string, string | undefined>
): string | undefined {
  return optionalString(env[definitions[id].envVar]);
}

export function getIntegrationCredential(
  id: IntegrationCredentialId,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  return environmentCredential(id, env) || openStoredCredential(readStoredCredentials(), id);
}

export function getIntegrationCredentialsStatus(
  env: Record<string, string | undefined> = process.env
): IntegrationCredentialsStatus {
  const stored = readStoredCredentials();
  return {
    credentials: INTEGRATION_CREDENTIAL_IDS.map((id) => {
      const definition = definitions[id];
      const environmentSecret = environmentCredential(id, env);
      const storedSecret = openStoredCredential(stored, id);
      return {
        id,
        label: definition.label,
        envVar: definition.envVar,
        configured: Boolean(environmentSecret || storedSecret),
        source: environmentSecret ? "env" : storedSecret ? "stored" : "none",
      };
    }),
  };
}

export function updateIntegrationCredentials(
  input: IntegrationCredentialsUpdate,
  env: Record<string, string | undefined> = process.env
): IntegrationCredentialsStatus {
  const stored = readStoredCredentials();
  const credentials = { ...stored.credentials };
  if (input.credentials !== undefined) {
    if (!input.credentials || typeof input.credentials !== "object") {
      throw new Error("Integration credentials must be an object");
    }
    for (const [rawId, value] of Object.entries(input.credentials)) {
      if (!INTEGRATION_CREDENTIAL_IDS.includes(rawId as IntegrationCredentialId)) {
        throw new Error(`Unsupported integration credential: ${rawId}`);
      }
      const id = rawId as IntegrationCredentialId;
      const envVar = definitions[id].envVar;
      if (environmentCredential(id, env)) {
        throw new Error(`${envVar} is set in the gateway environment and cannot be changed here`);
      }
      const normalized = normalizeSecret(value);
      if (normalized) credentials[id] = sealSecret(normalized, secretContext(id));
      else delete credentials[id];
    }
  }
  config.set(CONFIG_KEY, { credentials });
  return getIntegrationCredentialsStatus(env);
}
