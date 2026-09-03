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

export const DEFAULT_GATEWAY_CONNECT_TIMEOUT_MS = 8000;

export type BeforeGatewayRequest = (baseUrl: string) => Promise<void>;

export function normalizeConnectionPayloadInput(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("Connection payload must be text");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Connection payload is empty");
  }
  return trimmed;
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

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function isLocalNetworkGatewayUrl(input: string): boolean {
  const host = urlHost(input).replace(/^\[|\]$/g, "");
  if (!host || isLoopbackGatewayUrl(input)) return false;
  return (
    isPrivateIpv4(host) ||
    host.endsWith(".local") ||
    /^f[cd][0-9a-f:]+$/i.test(host) ||
    /^fe[89ab][0-9a-f:]+$/i.test(host)
  );
}

function connectionFailureMessage(profile: GatewayProfile): string {
  return networkFailureMessage(profile.baseUrl);
}

function gatewayPort(baseUrl: string): string {
  try {
    const parsed = new URL(normalizeGatewayUrl(baseUrl));
    return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return "4269";
  }
}

function networkFailureMessage(baseUrl: string): string {
  if (isLoopbackGatewayUrl(baseUrl)) {
    return "This QR points to localhost on the phone, not the computer running Cybara. In Cybara Settings > Gateway, turn on Listen on local network, create a new QR, and use the LAN URL.";
  }
  return `Could not reach ${baseUrl}. Open ${baseUrl}/api/health in this phone's browser to verify the network path. For LAN pairing, make sure the phone is on the same Wi-Fi, local network access is allowed, and the gateway computer's firewall allows inbound TCP ${gatewayPort(baseUrl)}. For remote pairing, make sure the private mesh or HTTPS tunnel is connected and the gateway URL matches Settings > Gateway > Remote Access.`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  failureMessage: string
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetchImpl(url, init);
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let fetchPromise: Promise<Response>;
  try {
    fetchPromise = Promise.resolve(fetchImpl(url, { ...init, signal: controller?.signal }));
  } catch {
    throw new Error(failureMessage);
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      fetchPromise,
      new Promise<Response>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller?.abort();
          reject(new Error(failureMessage));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === failureMessage) {
      throw error;
    }
    throw new Error(failureMessage);
  } finally {
    if (timeout) clearTimeout(timeout);
    fetchPromise.catch(() => undefined);
  }
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

export function isGatewaySessionListResponse(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.sessions) || Array.isArray(record.items);
}

export async function verifyGatewayProfile(
  profile: GatewayProfile,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_GATEWAY_CONNECT_TIMEOUT_MS
): Promise<void> {
  try {
    const response = await fetchWithTimeout(
      `${profile.baseUrl}/api/sessions?limit=1`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${profile.apiKey}`,
          ...(profile.gatewayPassword?.trim()
            ? { "X-Cybara-Gateway-Password": profile.gatewayPassword.trim() }
            : {}),
        },
      },
      fetchImpl,
      timeoutMs,
      connectionFailureMessage(profile)
    );
    if (!response.ok) {
      throw new Error(authFailureMessage(response.status));
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        "The gateway returned an incompatible sessions response. Update Cybara and reconnect."
      );
    }
    if (!isGatewaySessionListResponse(payload)) {
      throw new Error(
        "The gateway returned an incompatible sessions response. Update Cybara and reconnect."
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (/^The gateway /.test(error.message) ||
        /^This mobile device /.test(error.message) ||
        /^Could not reach /.test(error.message) ||
        /^This QR points /.test(error.message))
    ) {
      throw error;
    }
    throw new Error(connectionFailureMessage(profile));
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

const EXPO_DEV_LINK_PROTOCOLS = new Set(["exp:", "exps:"]);

export function mobileConnectDeepLinkPayload(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "cybara:") {
      const route = (url.hostname || url.pathname).replace(/^\/+/, "").toLowerCase();
      return route === "connect" ? url.searchParams.get("payload") : null;
    }
    if (EXPO_DEV_LINK_PROTOCOLS.has(url.protocol)) {
      const route = url.pathname
        .replace(/^\/+(--\/)?/, "")
        .replace(/\/+$/, "")
        .toLowerCase();
      return route === "connect" ? url.searchParams.get("payload") : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function isMobileConnectDeepLink(value: unknown): value is string {
  return mobileConnectDeepLinkPayload(value) !== null;
}

export function parseMobileConnectPayload(raw: unknown): MobileConnectPayload {
  const trimmed = normalizeConnectionPayloadInput(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error("Unsupported connection payload");
    }
    if (url.protocol !== "cybara:") {
      throw new Error("Unsupported connection payload");
    }
    const route = (url.hostname || url.pathname).replace(/^\/+/, "").toLowerCase();
    if (route !== "connect") {
      throw new Error("Unsupported Cybara mobile connection route");
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
  expiresAt?: number | string;
}

function pairingExpiryMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export async function redeemPairingCode(
  baseUrl: string,
  code: string,
  name = "Cybara Gateway",
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_GATEWAY_CONNECT_TIMEOUT_MS,
  beforeRequest?: BeforeGatewayRequest
): Promise<MobileConnectPayload> {
  const normalized = normalizeGatewayUrl(baseUrl);
  const trimmedCode = code.trim();
  if (!trimmedCode) throw new Error("Pairing code is missing");
  await beforeRequest?.(normalized);

  const response = await fetchWithTimeout(
    `${normalized}/api/mobile/pair/redeem`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: trimmedCode }),
    },
    fetchImpl,
    timeoutMs,
    networkFailureMessage(normalized)
  );
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

export async function resolveGatewayProfile(
  raw: unknown,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_GATEWAY_CONNECT_TIMEOUT_MS,
  beforeRequest?: BeforeGatewayRequest
): Promise<GatewayProfile> {
  const trimmed = normalizeConnectionPayloadInput(raw);

  const nestedPayload = mobileConnectDeepLinkPayload(trimmed);
  if (nestedPayload && nestedPayload !== trimmed) {
    return resolveGatewayProfile(nestedPayload, now, fetchImpl, timeoutMs, beforeRequest);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = null;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as { payload?: unknown }).payload === "string"
  ) {
    return resolveGatewayProfile(
      (parsed as { payload: string }).payload,
      now,
      fetchImpl,
      timeoutMs,
      beforeRequest
    );
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
    const expiresAt = pairingExpiryMillis(data.expiresAt);
    if (expiresAt !== undefined && expiresAt <= now.getTime()) {
      throw new Error("Pairing code has expired. Create a fresh QR code and scan it again.");
    }
    const payload = await redeemPairingCode(
      data.baseUrl,
      data.code,
      typeof data.name === "string" ? data.name : undefined,
      fetchImpl,
      timeoutMs,
      beforeRequest
    );
    return profileFromPayload(payload, now);
  }

  return profileFromPayload(parseMobileConnectPayload(trimmed), now);
}
