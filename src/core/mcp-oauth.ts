import { createHash, randomBytes } from "crypto";
import { config } from "./config";
import { encodeMcpOAuthEnvironment, type McpOAuthCredential } from "./mcp-http";

interface PendingMcpOAuth {
  serverId: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  tokenEndpoint: string;
  createdAt: number;
}

interface McpOAuthStatus {
  status: "pending" | "connected" | "error";
  serverId: string;
  error?: string;
}

export type McpOAuthUrlValidator = (url: string) => Promise<void>;

const pending = new Map<string, PendingMcpOAuth>();
const statuses = new Map<string, McpOAuthStatus>();

function httpsUrl(value: unknown, label: string): URL {
  if (typeof value !== "string") throw new Error(`${label} is missing`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  if (url.username || url.password || url.hash) throw new Error(`${label} is invalid`);
  return url;
}

function bearerMetadataUrl(header: string | null): URL {
  const match = header?.match(/resource_metadata="([^"]+)"/i);
  if (!match?.[1]) throw new Error("MCP server did not provide OAuth resource metadata");
  return httpsUrl(match[1], "OAuth resource metadata URL");
}

async function jsonResponse(url: URL, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OAuth request failed (${response.status})`);
  const value = (await response.json()) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OAuth endpoint returned an invalid response");
  }
  return value as Record<string, unknown>;
}

async function validateEndpoint(url: URL, validator?: McpOAuthUrlValidator): Promise<URL> {
  if (validator) await validator(url.toString());
  return url;
}

function authorizationMetadataUrl(issuer: URL): URL {
  return new URL(
    `/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, "")}`,
    issuer
  );
}

export async function startMcpOAuth(
  serverId: string,
  serverUrl: string,
  validator?: McpOAuthUrlValidator
): Promise<{ authUrl: string; state: string }> {
  const resourceUrl = await validateEndpoint(httpsUrl(serverUrl, "MCP server URL"), validator);
  const challengeResponse = await fetch(resourceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cybara", version: "1.0" },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (challengeResponse.status !== 401)
    throw new Error("MCP server did not request OAuth authentication");
  const resourceMetadataUrl = await validateEndpoint(
    bearerMetadataUrl(challengeResponse.headers.get("www-authenticate")),
    validator
  );
  const resourceMetadata = await jsonResponse(resourceMetadataUrl);
  const resource = httpsUrl(resourceMetadata.resource, "OAuth resource").toString();
  const authorizationServers = resourceMetadata.authorization_servers;
  if (!Array.isArray(authorizationServers) || typeof authorizationServers[0] !== "string") {
    throw new Error("OAuth authorization server metadata is missing");
  }
  const issuer = await validateEndpoint(
    httpsUrl(authorizationServers[0], "OAuth authorization server"),
    validator
  );
  const metadataUrl = await validateEndpoint(authorizationMetadataUrl(issuer), validator);
  const metadata = await jsonResponse(metadataUrl);
  const authorizationEndpoint = await validateEndpoint(
    httpsUrl(metadata.authorization_endpoint, "OAuth authorization endpoint"),
    validator
  );
  const tokenEndpoint = await validateEndpoint(
    httpsUrl(metadata.token_endpoint, "OAuth token endpoint"),
    validator
  );
  const registrationEndpoint = await validateEndpoint(
    httpsUrl(metadata.registration_endpoint, "OAuth registration endpoint"),
    validator
  );
  const runtimePort = Number(process.env.CYBARA_RUNTIME_PORT);
  const port =
    Number.isInteger(runtimePort) && runtimePort > 0
      ? runtimePort
      : config.get<number>("port") || 4269;
  const redirectUri = `http://127.0.0.1:${port}/api/mcp/oauth/callback`;
  const registration = await jsonResponse(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Cybara",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (typeof registration.client_id !== "string")
    throw new Error("OAuth client registration failed");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const scope = Array.isArray(resourceMetadata.scopes_supported)
    ? resourceMetadata.scopes_supported
        .filter((value): value is string => typeof value === "string")
        .join(" ")
    : "";
  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", registration.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", resource);
  authUrl.searchParams.set("state", state);
  if (scope) authUrl.searchParams.set("scope", scope);
  pending.set(state, {
    serverId,
    verifier,
    clientId: registration.client_id,
    redirectUri,
    resource,
    tokenEndpoint: tokenEndpoint.toString(),
    createdAt: Date.now(),
  });
  statuses.set(state, { status: "pending", serverId });
  return { authUrl: authUrl.toString(), state };
}

export async function finishMcpOAuth(
  state: string,
  code: string
): Promise<{ serverId: string; env: string }> {
  const request = pending.get(state);
  if (!request || Date.now() - request.createdAt > 10 * 60_000) {
    throw new Error("OAuth request is missing or expired");
  }
  pending.delete(state);
  try {
    const token = await jsonResponse(new URL(request.tokenEndpoint), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: request.redirectUri,
        client_id: request.clientId,
        code_verifier: request.verifier,
        resource: request.resource,
      }),
    });
    if (typeof token.access_token !== "string")
      throw new Error("OAuth token response is missing an access token");
    const credential: McpOAuthCredential = {
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : undefined,
      tokenEndpoint: request.tokenEndpoint,
      clientId: request.clientId,
      resource: request.resource,
      expiresAt:
        typeof token.expires_in === "number"
          ? Date.now() + Math.max(0, token.expires_in - 30) * 1000
          : undefined,
    };
    return { serverId: request.serverId, env: encodeMcpOAuthEnvironment(credential) };
  } catch (error) {
    statuses.set(state, {
      status: "error",
      serverId: request.serverId,
      error: error instanceof Error ? error.message : "OAuth failed",
    });
    throw error;
  }
}

export function completeMcpOAuth(state: string): void {
  const status = statuses.get(state);
  if (status) statuses.set(state, { status: "connected", serverId: status.serverId });
}

export function failMcpOAuth(state: string, error: unknown): void {
  const status = statuses.get(state);
  if (!status) return;
  statuses.set(state, {
    status: "error",
    serverId: status.serverId,
    error: error instanceof Error ? error.message : "OAuth connection failed",
  });
}

export function getMcpOAuthStatus(state: string): McpOAuthStatus | null {
  return statuses.get(state) || null;
}
