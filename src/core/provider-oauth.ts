export type OAuthTokenRequestFormat = "form" | "json";
export type OAuthRefreshMode = "standard" | "cursor" | "none";

export interface ProviderOAuthConfig {
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  callbackPort?: number;
  callbackPath?: string;
  callbackHostname?: "localhost" | "127.0.0.1";
  authorizeParams?: Record<string, string>;
  tokenRequestFormat?: OAuthTokenRequestFormat;
  tokenAccessField?: "access_token" | "accessToken" | "token";
  tokenRefreshField?: "refresh_token" | "refreshToken" | "token";
  includeStateInTokenRequest?: boolean;
  refreshMode?: OAuthRefreshMode;
  refreshHeaders?: Record<string, string>;
  tokenHeaders?: Record<string, string>;
  fallbackExpiresIn?: number;
  deviceCodeUrl?: string;
  discoveryUrl?: string;
  deviceCodeDiscoveryUrl?: string;
  specialFlow?: "cursor";
  identityHeaders?: "kimi-code";
}

export interface OAuthTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt: number;
}

function base64UrlText(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

export function jwtExpiresAt(token: string, fallbackExpiresIn = 3600): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) return Date.now() + fallbackExpiresIn * 1000;
    const decoded = JSON.parse(base64UrlText(payload)) as { exp?: unknown };
    if (typeof decoded.exp === "number" && Number.isFinite(decoded.exp)) {
      return decoded.exp * 1000;
    }
  } catch {}
  return Date.now() + fallbackExpiresIn * 1000;
}

export function parseOAuthTokenPayload(
  value: unknown,
  config: ProviderOAuthConfig
): OAuthTokenPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const accessField = config.tokenAccessField ?? "access_token";
  const refreshField = config.tokenRefreshField ?? "refresh_token";
  const accessToken = payload[accessField];
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;
  const refreshValue = payload[refreshField];
  const refreshToken =
    typeof refreshValue === "string" && refreshValue.length > 0 ? refreshValue : undefined;
  const expiresInValue = payload.expires_in;
  const expiresIn =
    typeof expiresInValue === "number" && Number.isFinite(expiresInValue)
      ? expiresInValue
      : undefined;
  const expiresAt = expiresIn
    ? Date.now() + expiresIn * 1000
    : jwtExpiresAt(accessToken, config.fallbackExpiresIn ?? 3600);
  return { accessToken, refreshToken, expiresIn, expiresAt };
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  return { verifier, challenge };
}
