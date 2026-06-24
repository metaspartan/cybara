/**
 * Rate-limit tracking from provider HTTP responses.
 *
 * Captures the `x-ratelimit-*` headers many providers return and exposes a
 * compact view so the credential pool and retry layer can decide whether to
 * wait, rotate, or proceed. Per-provider keyed. Pure data; no I/O.
 */

export interface RateLimitSnapshot {
  /** Epoch ms when this snapshot was recorded. */
  recordedAt: number;
  /** Remaining requests in the current window (if reported). */
  remaining?: number;
  /** Total requests allowed in the window. */
  limit?: number;
  /** Epoch ms when the window resets (if reported). */
  resetAt?: number;
  /** Reset interval in seconds reported by the header (if any). */
  resetSeconds?: number;
  /** Requests per minute, if derived. */
  rpm?: number;
  /** Tokens per minute, if reported. */
  tpm?: number;
}

export type RateLimitTier = "requests" | "tokens";

const snapshots = new Map<string, RateLimitSnapshot>();

function toNumber(value: string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse common x-ratelimit-* header variants across providers. */
export function parseRateLimitHeaders(headers: Headers): {
  requests?: RateLimitSnapshot;
  tokens?: RateLimitSnapshot;
} {
  const get = (name: string) => headers.get(name);
  const remainingRequests = toNumber(
    get("x-ratelimit-remaining-requests") ??
      get("x-ratelimit-limit-requests") ??
      get("x-ratelimit-remaining")
  );
  const limitRequests = toNumber(get("x-ratelimit-limit-requests") ?? get("x-ratelimit-limit"));
  const resetRequests = toNumber(get("x-ratelimit-reset-requests") ?? get("retry-after"));
  const remainingTokens = toNumber(get("x-ratelimit-remaining-tokens"));
  const limitTokens = toNumber(get("x-ratelimit-limit-tokens"));
  const resetTokens = toNumber(get("x-ratelimit-reset-tokens"));

  const now = Date.now();
  const requests: RateLimitSnapshot | undefined =
    remainingRequests !== undefined || limitRequests !== undefined || resetRequests !== undefined
      ? {
          recordedAt: now,
          remaining: remainingRequests,
          limit: limitRequests,
          resetSeconds: resetRequests,
          resetAt: resetRequests !== undefined ? now + resetRequests * 1000 : undefined,
        }
      : undefined;

  const tokens: RateLimitSnapshot | undefined =
    remainingTokens !== undefined || limitTokens !== undefined
      ? {
          recordedAt: now,
          remaining: remainingTokens,
          limit: limitTokens,
          resetSeconds: resetTokens,
          resetAt: resetTokens !== undefined ? now + resetTokens * 1000 : undefined,
        }
      : undefined;

  return { requests, tokens };
}

/** Record a rate-limit snapshot for a (provider, credential) key. */
export function recordRateLimit(
  key: string,
  headers: Headers
): { requests?: RateLimitSnapshot; tokens?: RateLimitSnapshot } {
  const parsed = parseRateLimitHeaders(headers);
  const now = Date.now();
  if (parsed.requests) snapshots.set(`${key}:requests`, { ...parsed.requests, recordedAt: now });
  if (parsed.tokens) snapshots.set(`${key}:tokens`, { ...parsed.tokens, recordedAt: now });
  return parsed;
}

export function getRateLimit(
  key: string,
  tier: RateLimitTier = "requests"
): RateLimitSnapshot | undefined {
  return snapshots.get(`${key}:${tier}`);
}

/**
 * Returns true when the (provider, credential) key is currently exhausted —
 * i.e. remaining is 0 and the reset window has not elapsed.
 */
export function isRateLimited(key: string, tier: RateLimitTier = "requests"): boolean {
  const snap = getRateLimit(key, tier);
  if (!snap) return false;
  if (snap.resetAt !== undefined && Date.now() >= snap.resetAt) return false;
  return snap.remaining !== undefined && snap.remaining <= 0;
}

/** Estimated ms to wait before the window resets (0 if unknown/reset). */
export function msUntilReset(key: string, tier: RateLimitTier = "requests"): number {
  const snap = getRateLimit(key, tier);
  if (!snap || snap.resetAt === undefined) return 0;
  return Math.max(0, snap.resetAt - Date.now());
}
