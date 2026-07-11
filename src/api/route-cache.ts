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
    const cached = cachedRouteResponses.get(routeKey);

    if (cached?.hasValue) {
      if (cached.expiresAt <= now && !cached.pending) {
        const generation = routeGeneration(routeKey);
        cached.pending = Promise.resolve()
          .then(() => handler(body, params))
          .then((value) => {
            if (routeGeneration(routeKey) === generation) {
              cachedRouteResponses.set(routeKey, {
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
          cachedRouteResponses.set(routeKey, {
            expiresAt: Date.now() + ttlMs,
            hasValue: true,
            value,
          });
        }
        return value;
      })
      .catch((error) => {
        if (routeGeneration(routeKey) === generation) {
          cachedRouteResponses.delete(routeKey);
        }
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
  "GET /api/provider-plans/status": 30_000,
};

const isTestEnv = process.env.NODE_ENV === "test";

export function invalidateCachedRoute(routeKey: string): void {
  cachedRouteGenerations.set(routeKey, routeGeneration(routeKey) + 1);
  cachedRouteResponses.delete(routeKey);
}

export function cacheMetricsRoutes(routes: Record<string, CacheableRouteHandler>): void {
  if (isTestEnv) return;
  for (const [routeKey, ttlMs] of Object.entries(cachedMetricsRouteTtls)) {
    const handler = routes[routeKey];
    if (handler) {
      routes[routeKey] = createCachedRouteHandler(routeKey, ttlMs, handler);
    }
  }
}

export function prewarmMetricsRoutes(routes: Record<string, CacheableRouteHandler>): void {
  if (isTestEnv) return;
  const routeKeys = Object.keys(cachedMetricsRouteTtls).filter((key) => routes[key]);
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
