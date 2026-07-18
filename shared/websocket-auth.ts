const WEBSOCKET_AUTH_PREFIX = "cybara.auth.";
const MAX_AUTH_PROTOCOL_LENGTH = 16_384;

export interface WebSocketAuthCredentials {
  token?: string;
  password?: string;
}

export interface ParsedWebSocketAuth extends WebSocketAuthCredentials {
  protocol: string;
}

function encodeHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function decodeHex(value: string): string | null {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function normalizedCredential(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createWebSocketAuthProtocol(credentials: WebSocketAuthCredentials): string | null {
  const token = normalizedCredential(credentials.token);
  const password = normalizedCredential(credentials.password);
  if (!token && !password) return null;
  const protocol = `${WEBSOCKET_AUTH_PREFIX}${encodeHex(JSON.stringify({ token, password }))}`;
  return protocol.length <= MAX_AUTH_PROTOCOL_LENGTH ? protocol : null;
}

export function parseWebSocketAuthProtocol(header: string | null | undefined): ParsedWebSocketAuth | null {
  if (!header) return null;
  for (const candidate of header.split(",").map((value) => value.trim())) {
    if (!candidate.startsWith(WEBSOCKET_AUTH_PREFIX)) continue;
    if (candidate.length > MAX_AUTH_PROTOCOL_LENGTH) return null;
    const decoded = decodeHex(candidate.slice(WEBSOCKET_AUTH_PREFIX.length));
    if (!decoded) return null;
    try {
      const parsed = JSON.parse(decoded) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const record = parsed as Record<string, unknown>;
      const token = normalizedCredential(record.token);
      const password = normalizedCredential(record.password);
      if (!token && !password) return null;
      return { protocol: candidate, token, password };
    } catch {
      return null;
    }
  }
  return null;
}
