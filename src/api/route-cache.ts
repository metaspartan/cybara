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

function cacheRouteHandler(
  routeKey: string,
  ttlMs: number,
  handler: CacheableRouteHandler
): CacheableRouteHandler {
  return async (body?: unknown, params?: Record<string, string>) => {
    const now = Date.now();
    const cached = cachedRouteResponses.get(routeKey);
    if (cached?.pending) return cached.pending;
    if (cached?.hasValue && cached.expiresAt > now) return cached.value;

    const pending = Promise.resolve(handler(body, params))
      .then((value) => {
        cachedRouteResponses.set(routeKey, {
          expiresAt: Date.now() + ttlMs,
          hasValue: true,
          value,
        });
        return value;
      })
      .catch((error) => {
        cachedRouteResponses.delete(routeKey);
        throw error;
      });

    cachedRouteResponses.set(routeKey, {
      expiresAt: now + ttlMs,
      hasValue: false,
      pending,
    });
    return pending;
  };
}

const cachedMetricsRouteTtls: Record<string, number> = {
  "GET /api/metrics/overview": 30_000,
  "GET /api/metrics/tokens": 30_000,
  "GET /api/metrics/token-analysis": 60_000,
  "GET /api/metrics/files": 30_000,
  "GET /api/metrics/tools": 30_000,
  "GET /api/metrics/time-series": 120_000,
  "GET /api/metrics/storage": 120_000,
  "GET /api/metrics/providers": 30_000,
  "GET /api/metrics/models": 30_000,
  "GET /api/metrics/insights": 60_000,
};

export function cacheMetricsRoutes(routes: Record<string, CacheableRouteHandler>): void {
  for (const [routeKey, ttlMs] of Object.entries(cachedMetricsRouteTtls)) {
    const handler = routes[routeKey];
    if (handler) {
      routes[routeKey] = cacheRouteHandler(routeKey, ttlMs, handler);
    }
  }
}
