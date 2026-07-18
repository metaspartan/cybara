import { resolveGeminiCliOAuthClientConfig } from "../core/gemini-cli-oauth";
import { createHash } from "crypto";
import {
  createPkcePair,
  parseOAuthTokenPayload,
  type ProviderOAuthConfig,
} from "../core/provider-oauth";
import { providers, resolveProviderType, type ProviderType } from "../core/providers";
import { escapeHtml } from "./html-escape";
import {
  consumeOAuthCallback,
  deleteOAuthCallback,
  OAUTH_CALLBACK_TTL_MS,
  setOAuthCallback,
  type OAuthCallbackEntry,
} from "./oauth-callbacks";
import type { RouteContext } from "./routes/_shared";

interface OAuthStartBody {
  providerType: string;
}

interface OAuthStatusBody {
  state?: unknown;
  poll_token?: unknown;
}

function oauthCallbackPrincipal(ctx?: RouteContext): string {
  const mobileDeviceId = ctx?.auth?.mobileDevice?.id;
  if (mobileDeviceId) return `mobile:${mobileDeviceId}`;
  const credential =
    ctx?.headers.authorization ||
    ctx?.headers.Authorization ||
    ctx?.headers["x-api-key"] ||
    ctx?.headers["X-API-Key"];
  if (credential) {
    return `credential:${createHash("sha256").update(credential).digest("hex")}`;
  }
  const clientIp = ctx?.clientIp?.trim().toLowerCase();
  if (
    !clientIp ||
    clientIp === "::1" ||
    clientIp === "0:0:0:0:0:0:0:1" ||
    clientIp.startsWith("127.") ||
    clientIp === "::ffff:127.0.0.1"
  ) {
    return "local";
  }
  return `network:${clientIp}`;
}

export function oauthCallbackOwner(ctx: RouteContext | undefined, pollToken: string): string {
  return createHash("sha256")
    .update(oauthCallbackPrincipal(ctx))
    .update("\0")
    .update(pollToken)
    .digest("hex");
}

export function resolveProviderOAuthCallbackHostname(value?: string): string {
  const hostname = value?.trim().toLowerCase() || "localhost";
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return hostname;
  }
  throw new Error("Provider OAuth callback hostname must be loopback-only");
}

function resolveOAuthConfig(providerType: string): {
  resolvedProviderType: ProviderType;
  config: ProviderOAuthConfig;
} {
  const resolvedProviderType = resolveProviderType(providerType);
  if (!resolvedProviderType) {
    throw new Error(`Validation error: unknown provider '${providerType}'`);
  }
  const provider = providers[resolvedProviderType] as {
    oauthFlow?: string;
    oauthConfig?: ProviderOAuthConfig;
  };
  if (provider.oauthFlow !== "redirect" || !provider.oauthConfig) {
    throw new Error(`Provider ${providerType} does not support OAuth redirect flow`);
  }
  const config = { ...provider.oauthConfig };
  if (resolvedProviderType === "google-gemini-cli") {
    const client = resolveGeminiCliOAuthClientConfig();
    const fallback = providers.antigravity.oauthConfig;
    config.clientId = client?.clientId || fallback.clientId;
    config.clientSecret = client?.clientSecret || config.clientSecret || fallback.clientSecret;
  }
  if (!config.authorizeUrl || !config.tokenUrl) {
    throw new Error(`Provider ${providerType} has incomplete OAuth endpoints`);
  }
  if (!config.clientId && resolvedProviderType !== "devin") {
    throw new Error(`Provider ${providerType} OAuth config is missing clientId`);
  }
  return { resolvedProviderType, config };
}

function callbackHtml(titleValue: string, messageValue: string, success: boolean): string {
  const title = escapeHtml(titleValue);
  const message = escapeHtml(messageValue);
  const color = success ? "#86efac" : "#fca5a5";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#e5e7eb;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.card{width:min(520px,calc(100vw - 2rem));border:1px solid #27272a;background:#18181b;border-radius:12px;padding:24px;box-shadow:0 20px 40px #0008}h1{margin:0 0 8px;font-size:22px;line-height:1.2;color:${color}}p{margin:0;color:#d4d4d8;font-size:15px;line-height:1.5}</style></head><body><main class="card" role="main" aria-live="polite"><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

export function buildProviderOAuthTokenRequest(
  config: ProviderOAuthConfig,
  code: string,
  verifier: string,
  state: string,
  redirectUri: string
): RequestInit {
  const fields: Record<string, string> = {
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  };
  if (config.clientId) fields.client_id = config.clientId;
  if (config.clientSecret) fields.client_secret = config.clientSecret;
  if (config.includeStateInTokenRequest) fields.state = state;
  const json = config.tokenRequestFormat === "json";
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded",
      ...config.tokenHeaders,
    },
    body: json ? JSON.stringify(fields) : new URLSearchParams(fields),
    signal: AbortSignal.timeout(30_000),
  };
}

async function exchangeToken(
  config: ProviderOAuthConfig,
  code: string,
  verifier: string,
  state: string,
  redirectUri: string
): Promise<OAuthCallbackEntry> {
  const response = await fetch(
    config.tokenUrl || "",
    buildProviderOAuthTokenRequest(config, code, verifier, state, redirectUri)
  );
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "error", error: `Token exchange returned HTTP ${response.status}` };
  }
  if (!response.ok) {
    const payload = value as Record<string, unknown>;
    const detail = payload.error_description ?? payload.error;
    return {
      status: "error",
      error: typeof detail === "string" ? detail : `Token exchange failed: HTTP ${response.status}`,
    };
  }
  const token = parseOAuthTokenPayload(value, config);
  if (!token) return { status: "error", error: "Token exchange returned an incomplete response" };
  return {
    status: "success",
    access_token: token.accessToken,
    refresh_token:
      token.refreshToken || (config.tokenRefreshField === "token" ? token.accessToken : undefined),
    expires_in: token.expiresIn,
    expires_at: token.expiresAt,
  };
}

export async function startProviderRedirectOAuth(
  body: unknown,
  ctx?: RouteContext
): Promise<Record<string, unknown>> {
  const { providerType } = body as OAuthStartBody;
  const { config } = resolveOAuthConfig(providerType);
  const pollToken = crypto.randomUUID();
  const owner = oauthCallbackOwner(ctx, pollToken);
  const { verifier, challenge } = await createPkcePair();
  const state = crypto.randomUUID();
  const callbackPath = config.callbackPath || "/callback";
  const callbackHostname = resolveProviderOAuthCallbackHostname(config.callbackHostname);
  let redirectUri = "";
  const server = Bun.serve({
    hostname: callbackHostname,
    port: config.callbackPort || 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname !== callbackPath) return new Response("Not found", { status: 404 });
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const callbackError = url.searchParams.get("error");
      let result: OAuthCallbackEntry;
      if (callbackError) {
        result = { status: "error", error: callbackError };
      } else if (!code || returnedState !== state) {
        result = { status: "error", error: "Invalid callback state" };
      } else {
        try {
          result = await exchangeToken(config, code, verifier, state, redirectUri);
        } catch (error) {
          result = {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      setOAuthCallback(state, result, owner);
      server.stop();
      const success = result.status === "success";
      return new Response(
        callbackHtml(
          success ? "Connected" : "Authorization failed",
          success ? "You can close this tab and return to Cybara." : result.error || "Try again.",
          success
        ),
        {
          status: success ? 200 : 400,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        }
      );
    },
  });
  const redirectHostname = callbackHostname === "::1" ? "[::1]" : callbackHostname;
  redirectUri = `http://${redirectHostname}:${server.port}${callbackPath}`;
  const authParams = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  if (config.clientId) authParams.set("client_id", config.clientId);
  if (config.scope) authParams.set("scope", config.scope);
  if (config.authorizeUrl?.includes("accounts.google.com")) {
    authParams.set("access_type", "offline");
    authParams.set("prompt", "consent");
  }
  for (const [key, value] of Object.entries(config.authorizeParams || {})) {
    if (value) authParams.set(key, value);
  }
  setOAuthCallback(state, { status: "pending" }, owner);
  setTimeout(() => {
    server.stop();
    deleteOAuthCallback(state);
  }, OAUTH_CALLBACK_TTL_MS);
  return {
    auth_url: `${config.authorizeUrl}?${authParams.toString()}`,
    state,
    poll_token: pollToken,
    callback_port: server.port,
  };
}

export function pollProviderRedirectOAuth(body: unknown, ctx?: RouteContext): OAuthCallbackEntry {
  const { state, poll_token: pollToken } = body as OAuthStatusBody;
  if (typeof state !== "string" || typeof pollToken !== "string" || !state || !pollToken) {
    return { status: "not_found" };
  }
  return (
    consumeOAuthCallback(state, oauthCallbackOwner(ctx, pollToken)) || {
      status: "not_found",
    }
  );
}
