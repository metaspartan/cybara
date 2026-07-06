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

    // Serve stale-while-revalidate: metrics queries scan millions of rows
    // synchronously, so an expired entry is returned immediately and refreshed
    // off the request path. Only the very first call ever computes inline.
    if (cached?.hasValue) {
      if (cached.expiresAt <= now && !cached.pending) {
        cached.pending = Promise.resolve()
          .then(() => handler(body, params))
          .then((value) => {
            cachedRouteResponses.set(routeKey, {
              expiresAt: Date.now() + ttlMs,
              hasValue: true,
              value,
            });
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

// Caching and prewarm are disabled under `bun test`: cached/prewarmed values
// leak across test files and mask the data each test just inserted.
const isTestEnv = process.env.NODE_ENV === "test";

export function cacheMetricsRoutes(routes: Record<string, CacheableRouteHandler>): void {
  if (isTestEnv) return;
  for (const [routeKey, ttlMs] of Object.entries(cachedMetricsRouteTtls)) {
    const handler = routes[routeKey];
    if (handler) {
      routes[routeKey] = cacheRouteHandler(routeKey, ttlMs, handler);
    }
  }
}

// Populate the metrics cache shortly after startup so the first dashboard
// visit is served warm instead of paying the multi-second cold scans. Routes
// run one at a time with a gap between them to avoid starving the event loop.
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
