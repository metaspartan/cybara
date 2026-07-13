import {
  getRequiredConnectorScopes,
  getStoredAccountConnector,
  storeAccountConnectorToken,
} from "./store";
import type { AccountConnectorId, StoredAccountConnector } from "./types";
import { connectorFetch, connectorRequiredString, parseConnectorJson } from "./request";

interface RefreshTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
}

function refreshedScopes(value: RefreshTokenResponse, stored: StoredAccountConnector): string[] {
  return typeof value.scope === "string" && value.scope.trim()
    ? value.scope.split(/\s+/).filter(Boolean)
    : stored.scopes;
}

function storeRefreshedToken(
  id: AccountConnectorId,
  stored: StoredAccountConnector,
  value: RefreshTokenResponse
): string {
  const accessToken = connectorRequiredString(value.access_token, "Access token");
  storeAccountConnectorToken(
    id,
    {
      accessToken,
      refreshToken:
        typeof value.refresh_token === "string" && value.refresh_token.trim()
          ? value.refresh_token.trim()
          : stored.refreshToken,
      expiresAt:
        typeof value.expires_in === "number" ? Date.now() + value.expires_in * 1000 : undefined,
      scopes: refreshedScopes(value, stored),
    },
    stored.account
  );
  return accessToken;
}

async function refreshGoogle(stored: StoredAccountConnector): Promise<string> {
  if (!stored.clientId || !stored.refreshToken) throw new Error("Reconnect Google Workspace");
  const body = new URLSearchParams({
    client_id: stored.clientId,
    refresh_token: stored.refreshToken,
    grant_type: "refresh_token",
  });
  if (stored.clientSecret) body.set("client_secret", stored.clientSecret);
  const response = await connectorFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return storeRefreshedToken(
    "google_workspace",
    stored,
    await parseConnectorJson<RefreshTokenResponse>(response)
  );
}

async function refreshMicrosoft(stored: StoredAccountConnector): Promise<string> {
  if (!stored.clientId || !stored.refreshToken) throw new Error("Reconnect Microsoft 365");
  const response = await connectorFetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: stored.clientId,
        refresh_token: stored.refreshToken,
        grant_type: "refresh_token",
        scope: getRequiredConnectorScopes("microsoft_365", stored.access).join(" "),
      }),
    }
  );
  return storeRefreshedToken(
    "microsoft_365",
    stored,
    await parseConnectorJson<RefreshTokenResponse>(response)
  );
}

async function refreshDropbox(stored: StoredAccountConnector): Promise<string> {
  if (!stored.clientId || !stored.refreshToken) throw new Error("Reconnect Dropbox");
  const response = await connectorFetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: stored.clientId,
      refresh_token: stored.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  return storeRefreshedToken(
    "dropbox",
    stored,
    await parseConnectorJson<RefreshTokenResponse>(response)
  );
}

async function refreshNotion(stored: StoredAccountConnector): Promise<string> {
  if (!stored.clientId || !stored.clientSecret || !stored.refreshToken) {
    throw new Error("Reconnect Notion");
  }
  const response = await connectorFetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${stored.clientId}:${stored.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "Notion-Version": "2026-03-11",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    }),
  });
  return storeRefreshedToken(
    "notion",
    stored,
    await parseConnectorJson<RefreshTokenResponse>(response)
  );
}

export async function getAccountConnectorAccessToken(
  id: AccountConnectorId,
  write = false
): Promise<string> {
  const stored = getStoredAccountConnector(id);
  if (write && stored.access !== "read_write") {
    throw new Error("Write access is disabled for this connector");
  }
  const requiredScopes = getRequiredConnectorScopes(id, write ? "read_write" : "read");
  if (requiredScopes.some((scope) => !stored.scopes.includes(scope))) {
    throw new Error("Reconnect this account to grant the required access");
  }
  if (stored.accessToken && (!stored.expiresAt || stored.expiresAt > Date.now() + 60_000)) {
    return stored.accessToken;
  }
  if (id === "google_workspace") return refreshGoogle(stored);
  if (id === "microsoft_365") return refreshMicrosoft(stored);
  if (id === "dropbox") return refreshDropbox(stored);
  return refreshNotion(stored);
}
