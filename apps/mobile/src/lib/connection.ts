export const MOBILE_CONNECT_PROTOCOL = "cybara-mobile-connect-v1";

export interface GatewayProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  createdAt: string;
  lastConnectedAt?: string;
}

export interface MobileConnectPayload {
  protocol: typeof MOBILE_CONNECT_PROTOCOL;
  name: string;
  baseUrl: string;
  apiKey: string;
  createdAt?: string;
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
    const baseUrl = url.searchParams.get("baseUrl") || "";
    const apiKey = url.searchParams.get("apiKey") || "";
    const name = url.searchParams.get("name") || "Cybara Gateway";
    return buildMobileConnectPayload({ name, baseUrl, apiKey });
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
    createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
  });
}

export function profileFromPayload(payload: MobileConnectPayload, now = new Date()): GatewayProfile {
  return {
    id: `${payload.name}:${payload.baseUrl}`.toLowerCase(),
    name: payload.name,
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    createdAt: payload.createdAt || now.toISOString(),
  };
}
