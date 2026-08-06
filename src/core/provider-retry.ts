import { classifyApiError } from "./error-classifier";

const MAX_RETRY_DELAY_MS = 120_000;

export interface ProviderRetryPolicy {
  maxRetries: number;
  maxDelayMs: number;
}

const DEFAULT_PROVIDER_RETRY_POLICY: ProviderRetryPolicy = {
  maxRetries: 5,
  maxDelayMs: MAX_RETRY_DELAY_MS,
};

const KIMI_PROVIDER_RETRY_POLICY: ProviderRetryPolicy = {
  maxRetries: 5,
  maxDelayMs: 180_000,
};

const OPENAI_CODEX_PROVIDER_RETRY_POLICY: ProviderRetryPolicy = {
  maxRetries: 5,
  maxDelayMs: 180_000,
};

export function resolveProviderRetryPolicy(providerType?: string): ProviderRetryPolicy {
  const normalized = providerType?.trim().toLowerCase() || "";
  if (normalized === "kimi-code" || normalized === "kimi-code-oauth") {
    return KIMI_PROVIDER_RETRY_POLICY;
  }
  if (normalized === "openai-codex") return OPENAI_CODEX_PROVIDER_RETRY_POLICY;
  return DEFAULT_PROVIDER_RETRY_POLICY;
}

function finiteNonNegative(value: string | null): number | undefined {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseProviderRetryAfterMs(
  headers: Headers,
  fallbackMs: number,
  nowMs = Date.now()
): number {
  const milliseconds = finiteNonNegative(headers.get("retry-after-ms"));
  if (milliseconds !== undefined) return Math.floor(milliseconds);

  const raw = headers.get("retry-after")?.trim();
  const seconds = finiteNonNegative(raw ?? null);
  if (seconds !== undefined) return Math.floor(seconds * 1000);
  if (raw) {
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  }
  return Math.max(0, Math.floor(fallbackMs));
}

export function providerRetryDelayMs(
  status: number,
  headers: Headers,
  attempt: number,
  random: () => number = Math.random
): number {
  const fallbackCapMs = status === 429 ? 30_000 : 8_000;
  const fallbackMs = Math.min(1000 * 2 ** Math.max(0, attempt), fallbackCapMs);
  const baseMs = status === 429 ? parseProviderRetryAfterMs(headers, fallbackMs) : fallbackMs;
  if (baseMs <= 0 || baseMs >= MAX_RETRY_DELAY_MS) return baseMs;
  const jitterRangeMs = Math.min(250, Math.ceil(baseMs * 0.2));
  return Math.ceil(baseMs + Math.max(0, Math.min(1, random())) * jitterRangeMs);
}

export function providerExceptionRetryDelayMs(
  error: unknown,
  attempt: number,
  signal?: AbortSignal,
  random: () => number = Math.random,
  maxRetries = DEFAULT_PROVIDER_RETRY_POLICY.maxRetries
): number | undefined {
  if (signal?.aborted) return undefined;
  const classified = classifyApiError({ error });
  if (!classified.retryable || attempt >= maxRetries) return undefined;
  return providerRetryDelayMs(0, new Headers(), attempt, random);
}

export function boundedPoolRetryDelayMs(poolDelayMs: number, retryDelayMs: number): number {
  return Math.max(Number.isFinite(poolDelayMs) ? poolDelayMs : 0, retryDelayMs);
}
