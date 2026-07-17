import { readFileSync } from "fs";
import { join } from "path";
import { resolveCybaraHome } from "../core/cybara-home";

export const CLI_API_BASE = process.env.CYBARA_API || "http://localhost:4269";

export const TUI_INPUT_OPTIONS = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown }).setRawMode ===
      "function",
};

export function resolveCliApiKey(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDir: string = resolveCybaraHome().dir
): string | null {
  const envKey = environment.CYBARA_API_KEY?.trim();
  if (envKey) return envKey;

  try {
    const keyPath = join(homeDir, "api_key");
    return readFileSync(keyPath, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export const CLI_API_KEY = resolveCliApiKey();

export function resolveCliGatewayPassword(
  environment: Readonly<Record<string, string | undefined>> = process.env
): string | null {
  return environment.CYBARA_GATEWAY_PASSWORD?.trim() || null;
}

export const CLI_GATEWAY_PASSWORD = resolveCliGatewayPassword();

export class CliApiError extends Error {
  readonly endpoint: string;
  readonly status: number | null;

  constructor(endpoint: string, message: string, status: number | null = null) {
    super(message);
    this.name = "CliApiError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

export interface CliApiRequestContext {
  apiBase?: string;
  apiKey?: string | null;
  gatewayPassword?: string | null;
  fetchImpl?: typeof fetch;
}

export function buildCliAuthHeaders(
  apiKey: string | null,
  headers?: RequestInit["headers"],
  ensureJsonContentType = false,
  gatewayPassword: string | null = null
): Headers {
  const merged = new Headers(headers);
  if (ensureJsonContentType && !merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }
  if (apiKey && !merged.has("Authorization")) {
    merged.set("Authorization", `Bearer ${apiKey}`);
  }
  if (gatewayPassword && !merged.has("X-Cybara-Gateway-Password")) {
    merged.set("X-Cybara-Gateway-Password", gatewayPassword);
  }
  return merged;
}

export function withCliAuthHeaders(
  headers?: RequestInit["headers"],
  ensureJsonContentType = false
): Headers {
  return buildCliAuthHeaders(
    resolveCliApiKey(),
    headers,
    ensureJsonContentType,
    resolveCliGatewayPassword()
  );
}

function apiErrorDetail(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    const detail = record[key];
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  }
  return "";
}

async function responseErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return "";
  try {
    return apiErrorDetail(JSON.parse(text)) || text.trim();
  } catch {
    return text.trim();
  }
}

export async function requestCliAPI<T>(
  endpoint: string,
  options?: RequestInit,
  context: CliApiRequestContext = {}
): Promise<T> {
  const apiBase = context.apiBase ?? CLI_API_BASE;
  const apiKey = context.apiKey === undefined ? resolveCliApiKey() : context.apiKey;
  const gatewayPassword =
    context.gatewayPassword === undefined ? resolveCliGatewayPassword() : context.gatewayPassword;
  const fetchImpl = context.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase}${endpoint}`, {
      ...options,
      headers: buildCliAuthHeaders(apiKey, options?.headers, true, gatewayPassword),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliApiError(endpoint, message);
  }
  if (!response.ok) {
    const detail = await responseErrorDetail(response);
    const statusText = response.statusText.trim();
    const suffix = detail || statusText || "Request failed";
    throw new CliApiError(endpoint, `HTTP ${response.status}: ${suffix}`, response.status);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new CliApiError(endpoint, "Gateway returned invalid JSON", response.status);
  }
}

export function formatCliApiError(error: unknown, apiBase = CLI_API_BASE): string {
  const message = error instanceof Error ? error.message : String(error);
  const endpoint = error instanceof CliApiError ? error.endpoint : "";
  const target = endpoint ? `${apiBase}${endpoint}` : apiBase;
  if (error instanceof CliApiError && error.status === 401) {
    return `Unauthorized (401) from ${target}. Refresh the local API key or CYBARA_API_KEY.`;
  }
  if (error instanceof CliApiError && error.status === 403) {
    return `Access denied (403) from ${target}. Set CYBARA_GATEWAY_PASSWORD if required.`;
  }
  if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
    return `Cannot connect to Cybara at ${apiBase}. Start it with: cybara start`;
  }
  return endpoint ? `${endpoint}: ${message}` : message;
}

export async function fetchCliAPI<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
  try {
    return await requestCliAPI<T>(endpoint, options);
  } catch (error) {
    console.error(`ERROR: ${formatCliApiError(error)}`);
    return null;
  }
}
