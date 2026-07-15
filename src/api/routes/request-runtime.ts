import { trackApiCall } from "../../core/metrics";
import { recordExternalSpan } from "../../core/external-telemetry";

export interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
}

export const requestLogs: RequestLog[] = [];

const MAX_LOGS = 1000;
const isProduction = process.env.NODE_ENV === "production";
const SECRET_CONFIG_KEY =
  /(secret|token|password|passwd|api[_-]?key|private[_-]?key|mnemonic|credential|seed)/i;
const PUBLIC_SECRET_SHAPED_CONFIG_KEYS = new Set(["token_optimization"]);

const corsBaseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

export const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
};

export function logRequest(log: RequestLog): void {
  requestLogs.unshift(log);
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.pop();
  }

  const logLevel = log.status >= 500 ? "error" : log.status >= 400 ? "warn" : "info";
  console[logLevel](
    `[API] ${log.method} ${log.path} ${log.status} ${log.durationMs}ms${log.error ? ` - ${log.error}` : ""}`
  );
}

export function recordApiMetrics(
  method: string,
  path: string,
  status: number,
  durationMs: number
): void {
  trackApiCall(path, method, status, durationMs);
  const endedAt = Date.now();
  recordExternalSpan({
    name: `${method} ${path}`,
    startedAt: endedAt - Math.max(0, durationMs),
    endedAt,
    statusCode: status,
    attributes: { method, path, durationMs },
  });
}

export function redactSecretConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cfg)) {
    out[key] =
      SECRET_CONFIG_KEY.test(key) &&
      !PUBLIC_SECRET_SHAPED_CONFIG_KEYS.has(key) &&
      value != null &&
      value !== ""
        ? "***redacted***"
        : value;
  }
  return out;
}

export function parseBoundedQueryNumber(
  raw: string | undefined,
  min: number,
  max: number
): number | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

export function buildCorsHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = { ...corsBaseHeaders };
  if (!isProduction && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}
