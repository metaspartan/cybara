export const MAX_CONNECTOR_TEXT_BYTES = 512 * 1024;
const MAX_EVENT_TEXT = 10_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const CONNECTOR_TIMEOUT_MS = 20_000;

export function connectorFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
  });
}

export function connectorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function connectorText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function connectorLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

export function connectorRequiredString(value: unknown, name: string): string {
  const normalized = connectorText(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function connectorStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return values.flatMap((item) => {
    const normalized = connectorText(item);
    return normalized ? [normalized] : [];
  });
}

export function connectorIsoDateTime(value: unknown, name: string): string {
  const normalized = connectorRequiredString(value, name);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a valid date and time`);
  return new Date(parsed).toISOString();
}

export function connectorBoundedText(
  value: unknown,
  maxLength = MAX_EVENT_TEXT
): string | undefined {
  const normalized = connectorText(value);
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export async function parseConnectorJson<T>(response: Response): Promise<T> {
  const value = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const record = value as Record<string, unknown>;
    const nested = connectorRecord(record.error);
    const message =
      connectorText(nested.message) ||
      connectorText(record.error_description) ||
      connectorText(record.error_summary) ||
      connectorText(record.message) ||
      connectorText(record.error) ||
      `Connector request failed (${response.status})`;
    throw new Error(message);
  }
  return value;
}

export async function boundedConnectorResponseText(response: Response): Promise<string> {
  if (!response.ok) {
    const value = await response.text();
    throw new Error(value.slice(0, 500) || `Connector request failed (${response.status})`);
  }
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_CONNECTOR_TEXT_BYTES) throw new Error("File is too large to read in chat");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CONNECTOR_TEXT_BYTES) {
    throw new Error("File is too large to read in chat");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function ensureConnectorContentSize(value: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_CONNECTOR_TEXT_BYTES) {
    throw new Error("Content is too large");
  }
}
