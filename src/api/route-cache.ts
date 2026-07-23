type CacheableRouteHandler = (
  body?: unknown,
  params?: Record<string, string>
) => Promise<unknown> | unknown;

interface CachedRouteEntry {
  expiresAt: number;
  hasValue: boolean;
  pending?: Promise<unknown>;
  value?: unknown;
}

const cachedRouteResponses = new Map<string, CachedRouteEntry>();
const cachedRouteGenerations = new Map<string, number>();

function requestCacheKey(
  routeKey: string,
  body?: unknown,
  params?: Record<string, string>
): string {
  const query = params
    ? Object.entries(params)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&")
    : "";
  const bodyKey = body === undefined ? "" : JSON.stringify(body);
  if (!query && !bodyKey) return routeKey;
  return `${routeKey}?${query}#${bodyKey}`;
}

function routeGeneration(routeKey: string): number {
  return cachedRouteGenerations.get(routeKey) ?? 0;
}

export function createCachedRouteHandler(
  routeKey: string,
  ttlMs: number,
  handler: CacheableRouteHandler
): CacheableRouteHandler {
  return async (body?: unknown, params?: Record<string, string>) => {
    const now = Date.now();
    const cacheKey = requestCacheKey(routeKey, body, params);
    const cached = cachedRouteResponses.get(cacheKey);

    if (cached?.hasValue) {
      if (cached.expiresAt <= now && !cached.pending) {
        const generation = routeGeneration(routeKey);
        cached.pending = Promise.resolve()
          .then(() => handler(body, params))
          .then((value) => {
            if (routeGeneration(routeKey) === generation) {
              cachedRouteResponses.set(cacheKey, {
                expiresAt: Date.now() + ttlMs,
                hasValue: true,
                value,
              });
            }
            return value;
          })
          .catch(() => {
            cached.pending = undefined;
            return cached.value;
          });
      }
      return cached.value;
    }
    if (cached?.pending) return cached.pending;

    const generation = routeGeneration(routeKey);
    const pending = Promise.resolve(handler(body, params))
      .then((value) => {
        if (routeGeneration(routeKey) === generation) {
          cachedRouteResponses.set(cacheKey, {
            expiresAt: Date.now() + ttlMs,
            hasValue: true,
            value,
          });
        }
        return value;
      })
      .catch((error) => {
        if (routeGeneration(routeKey) === generation) {
          cachedRouteResponses.delete(cacheKey);
        }
        throw error;
      });

    cachedRouteResponses.set(cacheKey, {
      expiresAt: now + ttlMs,
      hasValue: false,
      pending,
    });
    return pending;
  };
}

export const METRICS_ROUTE_CACHE_TTLS: Readonly<Record<string, number>> = {
  "GET /api/metrics/snapshot": 15_000,
  "GET /api/metrics/overview": 30_000,
  "GET /api/metrics/tokens": 30_000,
  "GET /api/metrics/token-analysis": 60_000,
  "GET /api/metrics/sessions": 15_000,
  "GET /api/metrics/files": 30_000,
  "GET /api/metrics/tools": 30_000,
  "GET /api/metrics/time-series": 120_000,
  "GET /api/metrics/storage": 120_000,
  "GET /api/metrics/providers": 30_000,
  "GET /api/metrics/models": 30_000,
  "GET /api/metrics/insights": 60_000,
  "GET /api/provider-plans/status": 30_000,
};

const isTestEnv = process.env.NODE_ENV === "test";

export function invalidateCachedRoute(routeKey: string): void {
  cachedRouteGenerations.set(routeKey, routeGeneration(routeKey) + 1);
  for (const key of cachedRouteResponses.keys()) {
    if (key === routeKey || key.startsWith(`${routeKey}?`)) cachedRouteResponses.delete(key);
  }
}

export function cacheMetricsRoutes(routes: Record<string, CacheableRouteHandler>): void {
  if (isTestEnv) return;
  for (const [routeKey, ttlMs] of Object.entries(METRICS_ROUTE_CACHE_TTLS)) {
    const handler = routes[routeKey];
    if (handler) {
      routes[routeKey] = createCachedRouteHandler(routeKey, ttlMs, handler);
    }
  }
}

export function prewarmMetricsRoutes(routes: Record<string, CacheableRouteHandler>): void {
  if (isTestEnv) return;
  const routeKeys = Object.keys(METRICS_ROUTE_CACHE_TTLS).filter(
    (key) => key !== "GET /api/metrics/snapshot" && routes[key]
  );
  let index = 0;
  const runNext = () => {
    if (index >= routeKeys.length) return;
    const handler = routes[routeKeys[index++]];
    Promise.resolve()
      .then(() => handler())
      .catch(() => {})
      .finally(() => setTimeout(runNext, 250));
  };
  setTimeout(runNext, 1_000);
}
