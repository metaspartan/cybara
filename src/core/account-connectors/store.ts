import { config } from "../config";
import { openSecret, sealSecret } from "../secret-storage";
import {
  ACCOUNT_CONNECTOR_IDS,
  type AccountConnectorAccess,
  type AccountConnectorConfigUpdate,
  type AccountConnectorDefinition,
  type AccountConnectorId,
  type AccountConnectorStatus,
  type AccountConnectorToken,
  type StoredAccountConnector,
} from "./types";

const CONFIG_KEY = "account_connectors";
const MAX_CREDENTIAL_LENGTH = 8192;

export const accountConnectorDefinitions: Record<AccountConnectorId, AccountConnectorDefinition> = {
  google_workspace: {
    id: "google_workspace",
    label: "Google Workspace",
    description:
      "Search Gmail, Drive, and Calendar, with optional email, file, and event creation.",
    services: ["Gmail", "Drive", "Calendar"],
    docsUrl: "https://console.cloud.google.com/apis/credentials",
    clientIdLabel: "OAuth client ID",
    clientSecretLabel: "OAuth client secret",
  },
  microsoft_365: {
    id: "microsoft_365",
    label: "Microsoft 365",
    description:
      "Search Outlook, OneDrive, and Calendar, with optional email, file, and event creation.",
    services: ["Outlook", "OneDrive", "Calendar"],
    docsUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    clientIdLabel: "Application client ID",
  },
  dropbox: {
    id: "dropbox",
    label: "Dropbox",
    description: "Search and read Dropbox files, with optional file uploads.",
    services: ["Files"],
    docsUrl: "https://www.dropbox.com/developers/apps",
    clientIdLabel: "App key",
  },
  notion: {
    id: "notion",
    label: "Notion",
    description: "Search and read workspace pages, with optional page creation.",
    services: ["Pages", "Databases"],
    docsUrl: "https://www.notion.so/profile/integrations",
    clientIdLabel: "OAuth client ID",
    clientSecretLabel: "OAuth client secret",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

function accessValue(value: unknown): AccountConnectorAccess {
  return value === "read_write" ? "read_write" : "read";
}

function secretContext(id: AccountConnectorId, field: string): string {
  return `account-connector:${id}:${field}`;
}

function openOptionalSecret(
  id: AccountConnectorId,
  field: string,
  value: unknown
): string | undefined {
  const sealed = optionalString(value);
  if (!sealed) return undefined;
  try {
    return openSecret(sealed, secretContext(id, field)).trim() || undefined;
  } catch {
    return undefined;
  }
}

function readConnector(id: AccountConnectorId, value: unknown): StoredAccountConnector {
  const record = isRecord(value) ? value : {};
  return {
    clientId: optionalString(record.clientId),
    clientSecret: openOptionalSecret(id, "client-secret", record.clientSecret),
    access: accessValue(record.access),
    accessToken: openOptionalSecret(id, "access-token", record.accessToken),
    refreshToken: openOptionalSecret(id, "refresh-token", record.refreshToken),
    expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : undefined,
    scopes: stringArray(record.scopes),
    account: optionalString(record.account),
  };
}

function rawConnectors(): Record<string, unknown> {
  const value = config.get<unknown>(CONFIG_KEY);
  if (!isRecord(value)) return {};
  return value;
}

function sealedConnector(
  id: AccountConnectorId,
  value: StoredAccountConnector
): Record<string, unknown> {
  return {
    ...(value.clientId ? { clientId: value.clientId } : {}),
    ...(value.clientSecret
      ? { clientSecret: sealSecret(value.clientSecret, secretContext(id, "client-secret")) }
      : {}),
    access: value.access,
    ...(value.accessToken
      ? { accessToken: sealSecret(value.accessToken, secretContext(id, "access-token")) }
      : {}),
    ...(value.refreshToken
      ? { refreshToken: sealSecret(value.refreshToken, secretContext(id, "refresh-token")) }
      : {}),
    ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}),
    scopes: value.scopes,
    ...(value.account ? { account: value.account } : {}),
  };
}

function saveConnector(id: AccountConnectorId, value: StoredAccountConnector): void {
  config.set(CONFIG_KEY, { ...rawConnectors(), [id]: sealedConnector(id, value) });
}

function normalizeCredential(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_CREDENTIAL_LENGTH) {
    throw new Error(`${label} must be ${MAX_CREDENTIAL_LENGTH} characters or fewer`);
  }
  return normalized;
}

export function isAccountConnectorId(value: unknown): value is AccountConnectorId {
  return typeof value === "string" && ACCOUNT_CONNECTOR_IDS.includes(value as AccountConnectorId);
}

export function getStoredAccountConnector(id: AccountConnectorId): StoredAccountConnector {
  return readConnector(id, rawConnectors()[id]);
}

export function updateStoredAccountConnector(
  id: AccountConnectorId,
  patch: Partial<StoredAccountConnector>
): StoredAccountConnector {
  const next = { ...getStoredAccountConnector(id), ...patch };
  saveConnector(id, next);
  return next;
}

export function updateAccountConnectorConfig(
  id: AccountConnectorId,
  input: AccountConnectorConfigUpdate
): AccountConnectorStatus {
  const current = getStoredAccountConnector(id);
  const clientId = normalizeCredential(input.clientId, "Client ID");
  const clientSecret = normalizeCredential(input.clientSecret, "Client secret");
  if (input.access !== undefined && input.access !== "read" && input.access !== "read_write") {
    throw new Error("Connector access must be read or read_write");
  }
  const access = input.access === undefined ? current.access : input.access;
  const credentialsChanged =
    (clientId !== undefined && clientId !== current.clientId) ||
    (clientSecret !== undefined && clientSecret !== current.clientSecret) ||
    access !== current.access;
  const next: StoredAccountConnector = {
    ...current,
    clientId: clientId === undefined ? current.clientId : clientId || undefined,
    clientSecret: clientSecret === undefined ? current.clientSecret : clientSecret || undefined,
    access,
    ...(credentialsChanged
      ? {
          accessToken: undefined,
          refreshToken: undefined,
          expiresAt: undefined,
          scopes: [],
          account: undefined,
        }
      : {}),
  };
  saveConnector(id, next);
  return getAccountConnectorStatus(id);
}

export function storeAccountConnectorToken(
  id: AccountConnectorId,
  token: AccountConnectorToken,
  account?: string
): void {
  updateStoredAccountConnector(id, {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken || getStoredAccountConnector(id).refreshToken,
    expiresAt: token.expiresAt,
    scopes: token.scopes,
    account,
  });
}

export function disconnectAccountConnector(id: AccountConnectorId): AccountConnectorStatus {
  updateStoredAccountConnector(id, {
    accessToken: undefined,
    refreshToken: undefined,
    expiresAt: undefined,
    scopes: [],
    account: undefined,
  });
  return getAccountConnectorStatus(id);
}

export function getRequiredConnectorScopes(
  id: AccountConnectorId,
  access: AccountConnectorAccess
): string[] {
  if (id === "google_workspace") {
    return [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      ...(access === "read_write"
        ? [
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/calendar.events",
          ]
        : []),
    ];
  }
  if (id === "microsoft_365") {
    return [
      "openid",
      "profile",
      "email",
      "offline_access",
      "User.Read",
      "Mail.Read",
      "Files.Read",
      "Calendars.Read",
      ...(access === "read_write" ? ["Mail.Send", "Files.ReadWrite", "Calendars.ReadWrite"] : []),
    ];
  }
  if (id === "notion") return [];
  return [
    "account_info.read",
    "files.metadata.read",
    "files.content.read",
    ...(access === "read_write" ? ["files.content.write"] : []),
  ];
}

export function getAccountConnectorRedirectUri(): string {
  const runtimePort = Number(process.env.CYBARA_RUNTIME_PORT);
  const port =
    Number.isInteger(runtimePort) && runtimePort > 0
      ? runtimePort
      : config.get<number>("port") || 4269;
  return `http://127.0.0.1:${port}/api/connectors/oauth/callback`;
}

export function getAccountConnectorStatus(id: AccountConnectorId): AccountConnectorStatus {
  const stored = getStoredAccountConnector(id);
  const requiredScopes = getRequiredConnectorScopes(id, stored.access);
  return {
    ...accountConnectorDefinitions[id],
    redirectUri: getAccountConnectorRedirectUri(),
    configured: Boolean(stored.clientId),
    connected: Boolean(stored.accessToken || stored.refreshToken),
    access: stored.access,
    ...(stored.account ? { account: stored.account } : {}),
    scopes: stored.scopes,
    needsReauthorization:
      Boolean(stored.accessToken || stored.refreshToken) &&
      requiredScopes.some((scope) => !stored.scopes.includes(scope)),
  };
}

export function listAccountConnectorStatuses(): AccountConnectorStatus[] {
  return ACCOUNT_CONNECTOR_IDS.map(getAccountConnectorStatus);
}
