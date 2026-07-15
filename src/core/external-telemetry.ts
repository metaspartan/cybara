import { config } from "./config";
import { createLogger } from "./logger";
import { redactSecrets } from "./redaction";
import { isSealedSecret, openSecret, sealSecret } from "./secret-storage";

export interface ExternalTelemetrySettings {
  enabled: boolean;
  serviceName: string;
  environment: string;
  prometheusEnabled: boolean;
  otlpEnabled: boolean;
  otlpEndpoint: string;
  otlpHeaders: Record<string, string>;
  metricsEnabled: boolean;
  tracesEnabled: boolean;
  exportIntervalMs: number;
}

export interface ExternalTelemetryStatus {
  enabled: boolean;
  queuedMetrics: number;
  queuedSpans: number;
  lastExportAt: string | null;
  lastError: string | null;
  exportedMetrics: number;
  exportedSpans: number;
}

interface TelemetryMetricPoint {
  name: string;
  value: number;
  timestamp: number;
  attributes: Record<string, string | number | boolean>;
}

interface TelemetrySpan {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  statusCode: number;
  attributes: Record<string, string | number | boolean>;
}

interface StoredTelemetrySettings extends Omit<ExternalTelemetrySettings, "otlpHeaders"> {
  otlpHeaders: Record<string, string> | string;
}

const DEFAULT_EXTERNAL_TELEMETRY_SETTINGS: ExternalTelemetrySettings = {
  enabled: false,
  serviceName: "cybara",
  environment: "production",
  prometheusEnabled: false,
  otlpEnabled: false,
  otlpEndpoint: "http://127.0.0.1:4318",
  otlpHeaders: {},
  metricsEnabled: true,
  tracesEnabled: true,
  exportIntervalMs: 15_000,
};

const TELEMETRY_HEADERS_CONTEXT = "telemetry:otlp-headers";
const REDACTED_HEADER_VALUE = "***redacted***";
const MAX_QUEUE_SIZE = 10_000;
const metricQueue: TelemetryMetricPoint[] = [];
const spanQueue: TelemetrySpan[] = [];
const prometheusCounters = new Map<string, number>();
const log = createLogger("Telemetry");
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastExportAt: string | null = null;
let lastError: string | null = null;
let exportedMetrics = 0;
let exportedSpans = 0;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeEndpoint(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_EXTERNAL_TELEMETRY_SETTINGS.otlpEndpoint;
  }
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Telemetry endpoint must use HTTP or HTTPS");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function normalizeHeaders(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const name = key.trim();
    if (!name || typeof entry !== "string" || !entry.trim()) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      throw new Error(`Invalid telemetry header name: ${name}`);
    }
    headers[name] = entry.trim();
  }
  return headers;
}

function openStoredHeaders(value: unknown): Record<string, string> {
  if (typeof value === "string" && isSealedSecret(value)) {
    try {
      return normalizeHeaders(JSON.parse(openSecret(value, TELEMETRY_HEADERS_CONTEXT)));
    } catch {
      return {};
    }
  }
  return normalizeHeaders(value);
}

function normalizeSettings(value: unknown): ExternalTelemetrySettings {
  const record = asRecord(value) || {};
  let otlpEndpoint = DEFAULT_EXTERNAL_TELEMETRY_SETTINGS.otlpEndpoint;
  try {
    otlpEndpoint = normalizeEndpoint(record.otlpEndpoint);
  } catch {
    otlpEndpoint = DEFAULT_EXTERNAL_TELEMETRY_SETTINGS.otlpEndpoint;
  }
  return {
    enabled: record.enabled === true,
    serviceName:
      typeof record.serviceName === "string" && record.serviceName.trim()
        ? record.serviceName.trim().slice(0, 80)
        : DEFAULT_EXTERNAL_TELEMETRY_SETTINGS.serviceName,
    environment:
      typeof record.environment === "string" && record.environment.trim()
        ? record.environment.trim().slice(0, 80)
        : DEFAULT_EXTERNAL_TELEMETRY_SETTINGS.environment,
    prometheusEnabled: record.prometheusEnabled === true,
    otlpEnabled: record.otlpEnabled === true,
    otlpEndpoint,
    otlpHeaders: openStoredHeaders(record.otlpHeaders),
    metricsEnabled: record.metricsEnabled !== false,
    tracesEnabled: record.tracesEnabled !== false,
    exportIntervalMs:
      typeof record.exportIntervalMs === "number" && Number.isFinite(record.exportIntervalMs)
        ? Math.min(300_000, Math.max(5_000, Math.floor(record.exportIntervalMs)))
        : DEFAULT_EXTERNAL_TELEMETRY_SETTINGS.exportIntervalMs,
  };
}

function storedSettings(settings: ExternalTelemetrySettings): StoredTelemetrySettings {
  return {
    ...settings,
    otlpHeaders:
      Object.keys(settings.otlpHeaders).length > 0
        ? sealSecret(JSON.stringify(settings.otlpHeaders), TELEMETRY_HEADERS_CONTEXT)
        : {},
  };
}

function publicSettings(settings: ExternalTelemetrySettings): ExternalTelemetrySettings {
  return {
    ...settings,
    otlpHeaders: Object.fromEntries(
      Object.keys(settings.otlpHeaders).map((key) => [key, REDACTED_HEADER_VALUE])
    ),
  };
}

export function getExternalTelemetrySettings(options?: {
  redactHeaders?: boolean;
}): ExternalTelemetrySettings {
  const settings = normalizeSettings(config.get<unknown>("external_telemetry"));
  return options?.redactHeaders === false ? settings : publicSettings(settings);
}

export function setExternalTelemetrySettings(value: unknown): ExternalTelemetrySettings {
  const current = getExternalTelemetrySettings({ redactHeaders: false });
  const update = asRecord(value) || {};
  const requestedHeaders = Object.hasOwn(update, "otlpHeaders")
    ? normalizeHeaders(update.otlpHeaders)
    : current.otlpHeaders;
  const mergedHeaders = Object.fromEntries(
    Object.entries(requestedHeaders).map(([key, entry]) => [
      key,
      entry === REDACTED_HEADER_VALUE ? current.otlpHeaders[key] || "" : entry,
    ])
  );
  const requestedEndpoint = Object.hasOwn(update, "otlpEndpoint")
    ? normalizeEndpoint(update.otlpEndpoint)
    : current.otlpEndpoint;
  const normalized = normalizeSettings({
    ...current,
    ...update,
    otlpEndpoint: requestedEndpoint,
    otlpHeaders: mergedHeaders,
  });
  config.set("external_telemetry", storedSettings(normalized));
  configureTelemetryFlush(normalized);
  return publicSettings(normalized);
}

function sanitizeMetricName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_:]/g, "_");
  return /^[a-zA-Z_:]/.test(normalized) ? normalized : `cybara_${normalized}`;
}

function telemetryAttributes(
  metadata?: Record<string, unknown>
): Record<string, string | number | boolean> {
  const safe = redactSecrets(metadata || {}) as Record<string, unknown>;
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(safe)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[key] = value;
    }
  }
  return attributes;
}

export function recordExternalMetric(
  type: string,
  key: string,
  value: number,
  metadata?: Record<string, unknown>
): void {
  if (!Number.isFinite(value)) return;
  const settings = getExternalTelemetrySettings({ redactHeaders: false });
  const name = sanitizeMetricName(`cybara_${type}_${key}`);
  prometheusCounters.set(name, (prometheusCounters.get(name) || 0) + value);
  if (!settings.enabled || !settings.metricsEnabled || !settings.otlpEnabled) return;
  metricQueue.push({
    name,
    value,
    timestamp: Date.now(),
    attributes: telemetryAttributes(metadata),
  });
  if (metricQueue.length > MAX_QUEUE_SIZE)
    metricQueue.splice(0, metricQueue.length - MAX_QUEUE_SIZE);
  configureTelemetryFlush(settings);
}

function randomHex(bytes: number): string {
  return crypto
    .getRandomValues(new Uint8Array(bytes))
    .reduce((output, value) => output + value.toString(16).padStart(2, "0"), "");
}

export function recordExternalSpan(input: {
  name: string;
  startedAt: number;
  endedAt: number;
  statusCode: number;
  attributes?: Record<string, unknown>;
}): void {
  const settings = getExternalTelemetrySettings({ redactHeaders: false });
  if (!settings.enabled || !settings.tracesEnabled || !settings.otlpEnabled) return;
  spanQueue.push({
    traceId: randomHex(16),
    spanId: randomHex(8),
    name: input.name.slice(0, 160),
    startTimeUnixNano: String(Math.floor(input.startedAt * 1_000_000)),
    endTimeUnixNano: String(Math.floor(input.endedAt * 1_000_000)),
    statusCode: input.statusCode,
    attributes: telemetryAttributes(input.attributes),
  });
  if (spanQueue.length > MAX_QUEUE_SIZE) spanQueue.splice(0, spanQueue.length - MAX_QUEUE_SIZE);
  configureTelemetryFlush(settings);
}

function otlpAttributes(attributes: Record<string, string | number | boolean>): unknown[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value:
      typeof value === "number"
        ? { doubleValue: value }
        : typeof value === "boolean"
          ? { boolValue: value }
          : { stringValue: value },
  }));
}

function resourceAttributes(settings: ExternalTelemetrySettings): unknown[] {
  return otlpAttributes({
    "service.name": settings.serviceName,
    "deployment.environment.name": settings.environment,
  });
}

async function postOtlp(
  path: string,
  body: unknown,
  settings: ExternalTelemetrySettings
): Promise<void> {
  const response = await fetch(`${settings.otlpEndpoint}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...settings.otlpHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`OTLP export failed with HTTP ${response.status}`);
}

export async function flushExternalTelemetry(): Promise<ExternalTelemetryStatus> {
  const settings = getExternalTelemetrySettings({ redactHeaders: false });
  if (!settings.enabled || !settings.otlpEnabled) return getExternalTelemetryStatus();
  const metrics = metricQueue.splice(0, metricQueue.length);
  const spans = spanQueue.splice(0, spanQueue.length);
  try {
    if (metrics.length > 0 && settings.metricsEnabled) {
      await postOtlp(
        "/v1/metrics",
        {
          resourceMetrics: [
            {
              resource: { attributes: resourceAttributes(settings) },
              scopeMetrics: [
                {
                  scope: { name: "cybara" },
                  metrics: metrics.map((metric) => ({
                    name: metric.name,
                    gauge: {
                      dataPoints: [
                        {
                          asDouble: metric.value,
                          timeUnixNano: String(Math.floor(metric.timestamp * 1_000_000)),
                          attributes: otlpAttributes(metric.attributes),
                        },
                      ],
                    },
                  })),
                },
              ],
            },
          ],
        },
        settings
      );
      exportedMetrics += metrics.length;
    }
    if (spans.length > 0 && settings.tracesEnabled) {
      await postOtlp(
        "/v1/traces",
        {
          resourceSpans: [
            {
              resource: { attributes: resourceAttributes(settings) },
              scopeSpans: [
                {
                  scope: { name: "cybara" },
                  spans: spans.map((span) => ({
                    traceId: span.traceId,
                    spanId: span.spanId,
                    name: span.name,
                    kind: 1,
                    startTimeUnixNano: span.startTimeUnixNano,
                    endTimeUnixNano: span.endTimeUnixNano,
                    status: { code: span.statusCode >= 400 ? 2 : 1 },
                    attributes: otlpAttributes(span.attributes),
                  })),
                },
              ],
            },
          ],
        },
        settings
      );
      exportedSpans += spans.length;
    }
    lastExportAt = new Date().toISOString();
    lastError = null;
  } catch (error) {
    metricQueue.unshift(...metrics);
    spanQueue.unshift(...spans);
    lastError = error instanceof Error ? error.message : String(error);
    await log.warn("External telemetry export failed", { error: lastError });
  }
  return getExternalTelemetryStatus();
}

function configureTelemetryFlush(
  settings = getExternalTelemetrySettings({ redactHeaders: false })
): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (!settings.enabled || !settings.otlpEnabled) return;
  flushTimer = setInterval(() => void flushExternalTelemetry(), settings.exportIntervalMs);
  flushTimer.unref?.();
}

export function getExternalTelemetryStatus(): ExternalTelemetryStatus {
  const settings = getExternalTelemetrySettings({ redactHeaders: false });
  return {
    enabled: settings.enabled,
    queuedMetrics: metricQueue.length,
    queuedSpans: spanQueue.length,
    lastExportAt,
    lastError,
    exportedMetrics,
    exportedSpans,
  };
}

export function renderPrometheusMetrics(): string {
  const settings = getExternalTelemetrySettings({ redactHeaders: false });
  if (!settings.enabled || !settings.prometheusEnabled) {
    throw new Error("Prometheus export is disabled");
  }
  return [...prometheusCounters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, value]) => [`# TYPE ${name} counter`, `${name} ${value}`])
    .join("\n")
    .concat("\n");
}

export async function testExternalTelemetry(): Promise<ExternalTelemetryStatus> {
  recordExternalMetric("telemetry", "test", 1, { source: "settings" });
  recordExternalSpan({
    name: "cybara.telemetry.test",
    startedAt: Date.now() - 1,
    endedAt: Date.now(),
    statusCode: 200,
  });
  return await flushExternalTelemetry();
}

configureTelemetryFlush();
