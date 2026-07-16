import { providers, resolveProviderType, type ProviderType } from "../core/providers";
import { getAppVersion } from "../core/build-info";
import {
  isMiniMaxPortalOAuth,
  pollMiniMaxPortalOAuth,
  startMiniMaxPortalOAuth,
} from "./provider-oauth-minimax";
import { pollCursorOAuth, startCursorOAuth } from "./provider-oauth-cursor";

interface DeviceOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  deviceCodeUrl?: string;
  tokenUrl?: string;
  discoveryUrl?: string;
  deviceCodeDiscoveryUrl?: string;
}

interface DeviceOAuthEndpoints {
  deviceCodeUrl: string;
  tokenUrl: string;
}

function deviceOAuthHeaders(providerType: ProviderType): Record<string, string> {
  const appVersion = getAppVersion();
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": `Cybara/${appVersion}`,
    ...(providerType === "xai-oauth"
      ? {
          "x-grok-client-surface": "ui",
          "x-grok-client-version": appVersion,
        }
      : {}),
  };
}

function isTrustedXaiOAuthEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "x.ai" || parsed.hostname.endsWith(".x.ai"))
    );
  } catch {
    return false;
  }
}

function validateOAuthEndpoint(providerType: string, endpoint: string, label: string): string {
  if (providerType === "xai-oauth" && !isTrustedXaiOAuthEndpoint(endpoint)) {
    throw new Error(`Validation error: xAI OAuth discovery returned an untrusted ${label}`);
  }
  return endpoint;
}

async function discoverDeviceOAuthEndpoints(
  providerType: string,
  oauthConfig: DeviceOAuthConfig
): Promise<DeviceOAuthEndpoints> {
  const discoveryUrl = oauthConfig.deviceCodeDiscoveryUrl || oauthConfig.discoveryUrl;
  if (discoveryUrl) {
    validateOAuthEndpoint(providerType, discoveryUrl, "discovery URL");
    const res = await fetch(discoveryUrl, {
      headers: { Accept: "application/json", "User-Agent": "Cybara" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`OAuth discovery failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      device_authorization_endpoint?: unknown;
      token_endpoint?: unknown;
    };
    if (
      typeof json.device_authorization_endpoint !== "string" ||
      typeof json.token_endpoint !== "string"
    ) {
      throw new Error("OAuth discovery response is missing device-code endpoints");
    }
    return {
      deviceCodeUrl: validateOAuthEndpoint(
        providerType,
        json.device_authorization_endpoint,
        "device authorization endpoint"
      ),
      tokenUrl: validateOAuthEndpoint(providerType, json.token_endpoint, "token endpoint"),
    };
  }

  if (!oauthConfig.deviceCodeUrl || !oauthConfig.tokenUrl) {
    throw new Error(`Provider ${providerType} does not support device code OAuth flow`);
  }
  return {
    deviceCodeUrl: validateOAuthEndpoint(
      providerType,
      oauthConfig.deviceCodeUrl,
      "device authorization endpoint"
    ),
    tokenUrl: validateOAuthEndpoint(providerType, oauthConfig.tokenUrl, "token endpoint"),
  };
}

function oauthJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getDeviceOAuthConfig(providerType: string): {
  resolvedProviderType: ProviderType;
  oauthConfig: DeviceOAuthConfig & { clientId: string };
} {
  const resolvedProviderType = resolveProviderType(providerType);
  if (!resolvedProviderType)
    throw new Error(`Validation error: unknown provider '${providerType}'`);
  const config = providers[resolvedProviderType] as Record<string, unknown>;
  if (!config) throw new Error(`Validation error: unknown provider '${providerType}'`);

  const oauthConfig = config.oauthConfig as DeviceOAuthConfig | undefined;
  if (!oauthConfig?.clientId) {
    throw new Error(`Provider ${providerType} does not support device code OAuth flow`);
  }
  return {
    resolvedProviderType,
    oauthConfig: { ...oauthConfig, clientId: oauthConfig.clientId },
  };
}

export async function startProviderDeviceCodeOAuth(
  body: unknown
): Promise<Record<string, unknown>> {
  const { providerType } = body as { providerType: string };
  if (isMiniMaxPortalOAuth(providerType)) return startMiniMaxPortalOAuth(providerType);
  if (resolveProviderType(providerType) === "cursor") return startCursorOAuth();
  const { resolvedProviderType, oauthConfig } = getDeviceOAuthConfig(providerType);
  const endpoints = await discoverDeviceOAuthEndpoints(resolvedProviderType, oauthConfig);

  const res = await fetch(endpoints.deviceCodeUrl, {
    method: "POST",
    headers: deviceOAuthHeaders(resolvedProviderType),
    body: new URLSearchParams({
      client_id: oauthConfig.clientId,
      scope: oauthConfig.scope || "",
      ...(resolvedProviderType === "xai-oauth" ? { referrer: "grok-build" } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Device code request failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  };
  const verificationUri = validateOAuthEndpoint(
    resolvedProviderType,
    json.verification_uri,
    "device verification URI"
  );
  const verificationUriComplete =
    typeof json.verification_uri_complete === "string" && json.verification_uri_complete.trim()
      ? validateOAuthEndpoint(
          resolvedProviderType,
          json.verification_uri_complete,
          "complete device verification URI"
        )
      : undefined;

  return {
    device_code: json.device_code,
    user_code: json.user_code,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: json.expires_in,
    interval: json.interval,
  };
}

export async function pollProviderDeviceCodeOAuth(body: unknown): Promise<Record<string, unknown>> {
  const { providerType, deviceCode } = body as {
    providerType: string;
    deviceCode: string;
  };
  if (isMiniMaxPortalOAuth(providerType)) {
    return pollMiniMaxPortalOAuth(providerType, deviceCode);
  }
  if (resolveProviderType(providerType) === "cursor") return pollCursorOAuth(deviceCode);
  const { resolvedProviderType, oauthConfig } = getDeviceOAuthConfig(providerType);
  const endpoints = await discoverDeviceOAuthEndpoints(resolvedProviderType, oauthConfig);

  const res = await fetch(endpoints.tokenUrl, {
    method: "POST",
    headers: deviceOAuthHeaders(resolvedProviderType),
    body: new URLSearchParams({
      client_id: oauthConfig.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  let json: Record<string, unknown> = {};
  try {
    json = oauthJsonRecord(await res.json());
  } catch {
    json = {};
  }

  if (res.ok && typeof json.access_token === "string") {
    const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
    if (resolvedProviderType === "xai-oauth" && !refreshToken) {
      return {
        status: "error",
        error:
          "xAI OAuth did not return a refresh token. Re-run login; if it keeps happening, xAI rejected offline_access for this OAuth client.",
      };
    }
    const expiresIn =
      typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
        ? json.expires_in
        : undefined;
    return {
      status: "success",
      access_token: json.access_token,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      expires_at: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    };
  }

  if (!res.ok && !json.error) {
    return { status: "error", error: `Token poll failed: HTTP ${res.status}` };
  }

  const error = typeof json.error === "string" ? json.error : "unknown";
  if (error === "authorization_pending") {
    return { status: "pending" };
  }
  if (error === "slow_down") {
    return { status: "slow_down" };
  }
  if (error === "expired_token") {
    return { status: "expired" };
  }
  if (error === "access_denied" || error === "authorization_denied") {
    return { status: "denied" };
  }

  return { status: "error", error };
}
