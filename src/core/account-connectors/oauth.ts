import { createHash, randomBytes } from "crypto";
import {
  disconnectAccountConnector,
  getAccountConnectorRedirectUri,
  getRequiredConnectorScopes,
  getStoredAccountConnector,
  storeAccountConnectorToken,
} from "./store";
import type {
  AccountConnectorId,
  AccountConnectorOAuthStart,
  AccountConnectorOAuthStatus,
  AccountConnectorStatus,
  AccountConnectorToken,
} from "./types";
import { connectorFetch } from "./request";

const FLOW_TTL_MS = 10 * 60_000;

interface OAuthFlow {
  connectorId: AccountConnectorId;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  status: AccountConnectorOAuthStatus["status"];
  error?: string;
}

interface OAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const flows = new Map<string, OAuthFlow>();

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function cleanFlows(): void {
  const now = Date.now();
  for (const [state, flow] of flows) {
    if (flow.expiresAt <= now) flows.delete(state);
  }
}

function tokenFromResponse(
  value: OAuthTokenResponse,
  fallbackScopes: string[]
): AccountConnectorToken {
  if (typeof value.access_token !== "string" || !value.access_token.trim()) {
    const detail =
      typeof value.error_description === "string"
        ? value.error_description
        : typeof value.error === "string"
          ? value.error
          : "OAuth token exchange failed";
    throw new Error(detail);
  }
  const expiresIn = typeof value.expires_in === "number" ? value.expires_in : undefined;
  const scopes =
    typeof value.scope === "string" && value.scope.trim()
      ? value.scope.trim().split(/\s+/)
      : fallbackScopes;
  return {
    accessToken: value.access_token,
    ...(typeof value.refresh_token === "string" && value.refresh_token.trim()
      ? { refreshToken: value.refresh_token }
      : {}),
    ...(expiresIn ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    scopes,
  };
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const value = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const record = value as Record<string, unknown>;
    const message =
      typeof record.error_description === "string"
        ? record.error_description
        : typeof record.error === "string"
          ? record.error
          : `OAuth request failed (${response.status})`;
    throw new Error(message);
  }
  return value;
}

async function exchangeGoogle(flow: OAuthFlow, code: string): Promise<AccountConnectorToken> {
  const stored = getStoredAccountConnector("google_workspace");
  if (!stored.clientId) throw new Error("Google OAuth client ID is not configured");
  const body = new URLSearchParams({
    code,
    client_id: stored.clientId,
    redirect_uri: flow.redirectUri,
    grant_type: "authorization_code",
    code_verifier: flow.verifier,
  });
  if (stored.clientSecret) body.set("client_secret", stored.clientSecret);
  const response = await connectorFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return tokenFromResponse(
    await jsonResponse<OAuthTokenResponse>(response),
    getRequiredConnectorScopes("google_workspace", stored.access)
  );
}

async function exchangeDropbox(flow: OAuthFlow, code: string): Promise<AccountConnectorToken> {
  const stored = getStoredAccountConnector("dropbox");
  if (!stored.clientId) throw new Error("Dropbox app key is not configured");
  const response = await connectorFetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: stored.clientId,
      redirect_uri: flow.redirectUri,
      code_verifier: flow.verifier,
    }),
  });
  return tokenFromResponse(
    await jsonResponse<OAuthTokenResponse>(response),
    getRequiredConnectorScopes("dropbox", stored.access)
  );
}

async function exchangeMicrosoft(flow: OAuthFlow, code: string): Promise<AccountConnectorToken> {
  const stored = getStoredAccountConnector("microsoft_365");
  if (!stored.clientId) throw new Error("Microsoft application client ID is not configured");
  const response = await connectorFetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: stored.clientId,
        redirect_uri: flow.redirectUri,
        grant_type: "authorization_code",
        code_verifier: flow.verifier,
        scope: getRequiredConnectorScopes("microsoft_365", stored.access).join(" "),
      }),
    }
  );
  return tokenFromResponse(
    await jsonResponse<OAuthTokenResponse>(response),
    getRequiredConnectorScopes("microsoft_365", stored.access)
  );
}

async function exchangeNotion(flow: OAuthFlow, code: string): Promise<AccountConnectorToken> {
  const stored = getStoredAccountConnector("notion");
  if (!stored.clientId || !stored.clientSecret) {
    throw new Error("Notion OAuth credentials are not configured");
  }
  const response = await connectorFetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${stored.clientId}:${stored.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "Notion-Version": "2026-03-11",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: flow.redirectUri,
    }),
  });
  return tokenFromResponse(await jsonResponse<OAuthTokenResponse>(response), []);
}

async function accountLabel(id: AccountConnectorId, accessToken: string): Promise<string> {
  if (id === "google_workspace") {
    const response = await connectorFetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const value = await jsonResponse<{ email?: unknown; name?: unknown }>(response);
    if (typeof value.email === "string" && value.email.trim()) return value.email.trim();
    if (typeof value.name === "string" && value.name.trim()) return value.name.trim();
    return "Google account";
  }
  if (id === "microsoft_365") {
    const response = await connectorFetch(
      "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const value = await jsonResponse<{
      displayName?: unknown;
      mail?: unknown;
      userPrincipalName?: unknown;
    }>(response);
    for (const candidate of [value.mail, value.userPrincipalName, value.displayName]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "Microsoft account";
  }
  if (id === "notion") {
    const response = await connectorFetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2026-03-11",
      },
    });
    const value = await jsonResponse<{ name?: unknown }>(response);
    return typeof value.name === "string" && value.name.trim()
      ? value.name.trim()
      : "Notion workspace";
  }
  const response = await connectorFetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const value = await jsonResponse<{
    email?: unknown;
    name?: { display_name?: unknown };
  }>(response);
  if (typeof value.email === "string" && value.email.trim()) return value.email.trim();
  if (typeof value.name?.display_name === "string" && value.name.display_name.trim()) {
    return value.name.display_name.trim();
  }
  return "Dropbox account";
}

export function startAccountConnectorOAuth(id: AccountConnectorId): AccountConnectorOAuthStart {
  cleanFlows();
  const stored = getStoredAccountConnector(id);
  if (!stored.clientId) throw new Error("Configure the connector client ID before connecting");
  const state = base64Url(randomBytes(24));
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const callback = getAccountConnectorRedirectUri();
  const expiresAt = Date.now() + FLOW_TTL_MS;
  flows.set(state, {
    connectorId: id,
    verifier,
    redirectUri: callback,
    expiresAt,
    status: "pending",
  });
  const scopes = getRequiredConnectorScopes(id, stored.access);
  let authUrl: string;
  if (id === "google_workspace") {
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: stored.clientId,
      redirect_uri: callback,
      response_type: "code",
      scope: scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    })}`;
  } else if (id === "microsoft_365") {
    authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams(
      {
        client_id: stored.clientId,
        redirect_uri: callback,
        response_type: "code",
        response_mode: "query",
        scope: scopes.join(" "),
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }
    )}`;
  } else if (id === "dropbox") {
    authUrl = `https://www.dropbox.com/oauth2/authorize?${new URLSearchParams({
      client_id: stored.clientId,
      redirect_uri: callback,
      response_type: "code",
      token_access_type: "offline",
      scope: scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })}`;
  } else {
    if (!stored.clientSecret) throw new Error("Configure the Notion client secret first");
    authUrl = `https://api.notion.com/v1/oauth/authorize?${new URLSearchParams({
      client_id: stored.clientId,
      redirect_uri: callback,
      response_type: "code",
      owner: "user",
      state,
    })}`;
  }
  return { state, authUrl, expiresAt };
}

export async function finishAccountConnectorOAuth(state: string, code: string): Promise<void> {
  cleanFlows();
  const flow = flows.get(state);
  if (!flow || flow.status !== "pending") throw new Error("OAuth request is invalid or expired");
  try {
    const token =
      flow.connectorId === "google_workspace"
        ? await exchangeGoogle(flow, code)
        : flow.connectorId === "microsoft_365"
          ? await exchangeMicrosoft(flow, code)
          : flow.connectorId === "dropbox"
            ? await exchangeDropbox(flow, code)
            : await exchangeNotion(flow, code);
    const account = await accountLabel(flow.connectorId, token.accessToken);
    storeAccountConnectorToken(flow.connectorId, token, account);
    flow.status = "connected";
  } catch (error) {
    flow.status = "error";
    flow.error = error instanceof Error ? error.message : "OAuth connection failed";
    throw error;
  }
}

export function failAccountConnectorOAuth(state: string, error: string): void {
  cleanFlows();
  const flow = flows.get(state);
  if (!flow) return;
  flow.status = "error";
  flow.error = error;
}

export function getAccountConnectorOAuthStatus(state: string): AccountConnectorOAuthStatus {
  cleanFlows();
  const flow = flows.get(state);
  if (!flow) return { status: "not_found" };
  return {
    status: flow.status,
    connectorId: flow.connectorId,
    ...(flow.error ? { error: flow.error } : {}),
  };
}

export async function revokeAccountConnector(
  id: AccountConnectorId
): Promise<AccountConnectorStatus> {
  const stored = getStoredAccountConnector(id);
  const token =
    id === "google_workspace" ? stored.refreshToken || stored.accessToken : stored.accessToken;
  try {
    if (token && id === "google_workspace") {
      await connectorFetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(5_000),
      });
    } else if (token && id === "dropbox") {
      await connectorFetch("https://api.dropboxapi.com/2/auth/token/revoke", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
    }
  } catch {
    return disconnectAccountConnector(id);
  }
  return disconnectAccountConnector(id);
}
