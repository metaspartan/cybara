export const MOBILE_CONNECT_PROTOCOL = "cybara-mobile-connect-v1";

export interface GatewayProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  gatewayPassword?: string;
  deviceId?: string;
  createdAt: string;
  lastConnectedAt?: string;
}

export interface MobileConnectPayload {
  protocol: typeof MOBILE_CONNECT_PROTOCOL;
  name: string;
  baseUrl: string;
  apiKey: string;
  deviceId?: string;
  createdAt?: string;
}

function urlHost(input: string): string {
  try {
    return new URL(normalizeGatewayUrl(input)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLoopbackGatewayUrl(input: string): boolean {
  const host = urlHost(input);
  return (
    host === "localhost" || host === "::1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function connectionFailureMessage(profile: GatewayProfile): string {
  if (isLoopbackGatewayUrl(profile.baseUrl)) {
    return "This QR points to localhost on the phone, not the computer running Cybara. In Cybara Settings > Gateway, turn on Listen on local network, create a new QR, and use the LAN URL.";
  }
  return `Could not reach ${profile.baseUrl}. Make sure this phone is on the same Wi-Fi, the gateway is running, and Settings > Gateway > Listen on local network is enabled.`;
}

function authFailureMessage(status: number): string {
  if (status === 401) {
    return "The gateway rejected this mobile token. Create a fresh QR code and scan it again.";
  }
  if (status === 403) {
    return "This mobile device does not have access to that gateway action. Create a new QR with Standard access or higher.";
  }
  return `The gateway responded with HTTP ${status}.`;
}

export async function verifyGatewayProfile(
  profile: GatewayProfile,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000
): Promise<void> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout =
    controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetchImpl(`${profile.baseUrl}/api/sessions?limit=1`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
        ...(profile.gatewayPassword?.trim()
          ? { "X-Cybara-Gateway-Password": profile.gatewayPassword.trim() }
          : {}),
      },
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(authFailureMessage(response.status));
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (/^The gateway /.test(error.message) || /^This mobile device /.test(error.message))
    ) {
      throw error;
    }
    throw new Error(connectionFailureMessage(profile));
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function normalizeGatewayUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Gateway URL is required");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Gateway URL must use http or https");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function buildMobileConnectPayload(input: {
  name?: string;
  baseUrl: string;
  apiKey: string;
  deviceId?: string;
  createdAt?: string;
}): MobileConnectPayload {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error("API key is required");
  }

  return {
    protocol: MOBILE_CONNECT_PROTOCOL,
    name: input.name?.trim() || "Cybara Gateway",
    baseUrl: normalizeGatewayUrl(input.baseUrl),
    apiKey,
    deviceId: input.deviceId,
    createdAt: input.createdAt,
  };
}

export function encodeMobileConnectPayload(payload: MobileConnectPayload): string {
  return JSON.stringify(payload);
}

export function parseMobileConnectPayload(raw: string): MobileConnectPayload {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Connection payload is empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const url = new URL(trimmed);
    if (url.protocol !== "cybara:") {
      throw new Error("Unsupported connection payload");
    }
    const nestedPayload = url.searchParams.get("payload");
    if (nestedPayload) {
      return parseMobileConnectPayload(nestedPayload);
    }
    const baseUrl = url.searchParams.get("baseUrl") || "";
    const apiKey = url.searchParams.get("apiKey") || "";
    const deviceId = url.searchParams.get("deviceId") || undefined;
    const name = url.searchParams.get("name") || "Cybara Gateway";
    return buildMobileConnectPayload({ name, baseUrl, apiKey, deviceId });
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Connection payload must be an object");
  }

  const data = parsed as Partial<MobileConnectPayload>;
  if (data.protocol !== MOBILE_CONNECT_PROTOCOL) {
    throw new Error("Unsupported Cybara mobile connection protocol");
  }
  if (typeof data.baseUrl !== "string" || typeof data.apiKey !== "string") {
    throw new Error("Connection payload is missing baseUrl or apiKey");
  }

  return buildMobileConnectPayload({
    name: typeof data.name === "string" ? data.name : undefined,
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    deviceId: typeof data.deviceId === "string" ? data.deviceId : undefined,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
  });
}

export function profileFromPayload(
  payload: MobileConnectPayload,
  now = new Date()
): GatewayProfile {
  return {
    id: `${payload.name}:${payload.baseUrl}`.toLowerCase(),
    name: payload.name,
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    deviceId: payload.deviceId,
    createdAt: payload.createdAt || now.toISOString(),
  };
}

export const MOBILE_PAIRING_PROTOCOL = "cybara-mobile-pair-v1";

export interface MobilePairingCodePayload {
  protocol: typeof MOBILE_PAIRING_PROTOCOL;
  name: string;
  baseUrl: string;
  code: string;
  role?: string;
  expiresAt?: number;
}

/**
 * Exchange a one-time pairing code for a scoped device token at the gateway,
 * returning a direct-connect payload. Used by the newer, more secure pairing
 * flow where the QR carries only a short-lived code rather than a live token.
 */
export async function redeemPairingCode(
  baseUrl: string,
  code: string,
  name = "Cybara Gateway",
  fetchImpl: typeof fetch = fetch
): Promise<MobileConnectPayload> {
  const normalized = normalizeGatewayUrl(baseUrl);
  const trimmedCode = code.trim();
  if (!trimmedCode) throw new Error("Pairing code is missing");

  const response = await fetchImpl(`${normalized}/api/mobile/pair/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: trimmedCode }),
  });
  let data: Record<string, unknown> | null = null;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }
  const apiKey = typeof data?.apiKey === "string" ? data.apiKey : "";
  if (!response.ok || data?.success !== true || !apiKey) {
    const message =
      typeof data?.error === "string" ? data.error : `Pairing failed (${response.status})`;
    throw new Error(message);
  }
  const device = (data.device as { id?: string } | undefined) ?? undefined;
  const payloadName = (data.payload as { name?: string } | undefined)?.name;
  return buildMobileConnectPayload({
    name: typeof payloadName === "string" ? payloadName : name,
    baseUrl: normalized,
    apiKey,
    deviceId: typeof device?.id === "string" ? device.id : undefined,
  });
}

/**
 * Resolve any pairing input into a connectable profile. Handles both the newer
 * one-time pairing-code QR (redeemed over the network) and the legacy direct-
 * token payload (JSON or `cybara:` deep link).
 */
export async function resolveGatewayProfile(
  raw: string,
  now = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<GatewayProfile> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Connection payload is empty");

  try {
    const url = new URL(trimmed);
    const nestedPayload = url.protocol === "cybara:" ? url.searchParams.get("payload") : null;
    if (nestedPayload && nestedPayload !== trimmed) {
      return resolveGatewayProfile(nestedPayload, now, fetchImpl);
    }
  } catch {}

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = null;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as { protocol?: unknown }).protocol === MOBILE_PAIRING_PROTOCOL
  ) {
    const data = parsed as Partial<MobilePairingCodePayload>;
    if (typeof data.baseUrl !== "string" || typeof data.code !== "string") {
      throw new Error("Pairing code payload is missing baseUrl or code");
    }
    const payload = await redeemPairingCode(
      data.baseUrl,
      data.code,
      typeof data.name === "string" ? data.name : undefined,
      fetchImpl
    );
    return profileFromPayload(payload, now);
  }

  return profileFromPayload(parseMobileConnectPayload(trimmed), now);
}
