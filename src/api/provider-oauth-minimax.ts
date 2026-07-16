import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  MINIMAX_OAUTH_CLIENT_ID,
  MINIMAX_OAUTH_GRANT_TYPE,
  MINIMAX_OAUTH_SCOPE,
} from "../core/providers/minimax-oauth";

interface MiniMaxAuthorizationResponse {
  user_code?: unknown;
  verification_uri?: unknown;
  expired_in?: unknown;
  interval?: unknown;
  state?: unknown;
  error?: unknown;
}

interface MiniMaxTokenResponse {
  status?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expired_in?: unknown;
  resource_url?: unknown;
  notification_message?: unknown;
  base_resp?: { status_msg?: unknown };
}

interface MiniMaxOAuthSession {
  userCode: string;
  verifier: string;
  expiresAt: number;
  tokenUrl: string;
  clientId: string;
}

const MAX_SESSIONS = 100;
const sessions = new Map<string, MiniMaxOAuthSession>();

function regionConfig(providerType: string): {
  accountBaseUrl: string;
  apiHostname: string;
  verificationHostname: string;
} {
  if (providerType.trim().toLowerCase() === "minimax-portal-cn") {
    return {
      accountBaseUrl: "https://account.minimaxi.com",
      apiHostname: "api.minimaxi.com",
      verificationHostname: "platform.minimaxi.com",
    };
  }
  return {
    accountBaseUrl: "https://account.minimax.io",
    apiHostname: "api.minimax.io",
    verificationHostname: "platform.minimax.io",
  };
}

function normalizeDeadline(value: unknown, now: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  if (value >= 1_000_000_000_000) return value;
  if (value >= 1_000_000_000) return value * 1000;
  return now + value * 1000;
}

function normalizeIntervalSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 2;
  return value >= 1000 ? Math.ceil(value / 1000) : Math.ceil(value);
}

function trustedHttpsUrl(value: unknown, hostname: string): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === hostname ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function cleanupSessions(now = Date.now()): void {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (typeof oldest !== "string") break;
    sessions.delete(oldest);
  }
}

function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(16).toString("base64url"),
  };
}

export function isMiniMaxPortalOAuth(providerType: string): boolean {
  const normalized = providerType.trim().toLowerCase();
  return normalized === "minimax-portal" || normalized === "minimax-portal-cn";
}

export async function startMiniMaxPortalOAuth(
  providerType: string
): Promise<Record<string, unknown>> {
  cleanupSessions();
  const region = regionConfig(providerType);
  const codeUrl = `${region.accountBaseUrl}/oauth2/device/code`;
  const tokenUrl = `${region.accountBaseUrl}/oauth2/token`;
  const pkce = createPkce();
  const response = await fetch(codeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Cybara",
      "x-request-id": randomUUID(),
    },
    body: new URLSearchParams({
      client_id: MINIMAX_OAUTH_CLIENT_ID,
      scope: MINIMAX_OAUTH_SCOPE,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      state: pkce.state,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => ({}))) as MiniMaxAuthorizationResponse;
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `MiniMax authorization failed: HTTP ${response.status}`
    );
  }
  const verificationUri = trustedHttpsUrl(data.verification_uri, region.verificationHostname);
  const expiresAt = normalizeDeadline(data.expired_in, Date.now());
  if (
    typeof data.user_code !== "string" ||
    !verificationUri ||
    !expiresAt ||
    data.state !== pkce.state
  ) {
    throw new Error("Validation error: MiniMax returned an invalid authorization response");
  }
  const deviceCode = randomUUID();
  sessions.set(deviceCode, {
    userCode: data.user_code,
    verifier: pkce.verifier,
    expiresAt,
    tokenUrl,
    clientId: MINIMAX_OAUTH_CLIENT_ID,
  });
  return {
    device_code: deviceCode,
    user_code: data.user_code,
    verification_uri: verificationUri,
    expires_in: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
    interval: normalizeIntervalSeconds(data.interval),
  };
}

export async function pollMiniMaxPortalOAuth(
  providerType: string,
  deviceCode: string
): Promise<Record<string, unknown>> {
  cleanupSessions();
  const session = sessions.get(deviceCode);
  if (!session) return { status: "expired" };
  const region = regionConfig(providerType);
  const response = await fetch(session.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Cybara",
    },
    body: new URLSearchParams({
      grant_type: MINIMAX_OAUTH_GRANT_TYPE,
      client_id: session.clientId,
      user_code: session.userCode,
      code_verifier: session.verifier,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => ({}))) as MiniMaxTokenResponse;
  if (!response.ok) {
    const message = data.base_resp?.status_msg;
    return {
      status: "error",
      error:
        typeof message === "string"
          ? message
          : `MiniMax token poll failed: HTTP ${response.status}`,
    };
  }
  if (data.status !== "success") {
    if (data.status === "error") {
      const message = data.base_resp?.status_msg;
      return {
        status: "error",
        error: typeof message === "string" ? message : "MiniMax authorization failed",
      };
    }
    return { status: "pending" };
  }
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
    return {
      status: "error",
      error: "MiniMax returned an incomplete token response",
    };
  }
  sessions.delete(deviceCode);
  const expiresAt = normalizeDeadline(data.expired_in, Date.now());
  const resourceUrl = trustedHttpsUrl(data.resource_url, region.apiHostname);
  return {
    status: "success",
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    resource_url: resourceUrl,
    notification_message:
      typeof data.notification_message === "string" ? data.notification_message : undefined,
  };
}
