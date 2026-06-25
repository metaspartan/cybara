/**
 * Weighted model/provider router with budget + rate limiting.
 *
 * A feature unique to cybara (neither openclaw nor hermes has this). Lets users
 * configure per-provider weights + spend/rate limits, and the router selects the
 * best available provider for each request based on:
 *  - Weighted random selection (higher weight = more traffic)
 *  - Rate limits (requests per 5h window, per week)
 *  - Spend limits ($ per day / week / month)
 *  - Per-request token-pricing estimation
 *  - Automatic failover to the next-weighted provider on error/rate-limit
 *
 * Configured via runtime config ("router" key) or the API + UI.
 */

import { config } from "./config";
import { classifyApiError } from "./error-classifier";
import { providerManager } from "./providers";

// --- Types ---

export interface ProviderRouteConfig {
  /** Routing weight (0-100). Higher = more traffic. Default 50. */
  weight: number;
  /** Max requests in the rolling 5-hour window. 0 = unlimited. */
  limit5h?: number;
  /** Max requests in the rolling 7-day window. 0 = unlimited. */
  limitWeekly?: number;
  /** Max spend ($USD) per day. 0 = unlimited. */
  spendLimitDaily?: number;
  /** Max spend ($USD) per week. 0 = unlimited. */
  spendLimitWeekly?: number;
  /** Input price per 1M tokens ($USD). For spend tracking. */
  priceInputPerM?: number;
  /** Output price per 1M tokens ($USD). For spend tracking. */
  priceOutputPerM?: number;
  /** Whether this route is enabled. Default true. */
  enabled?: boolean;
}

export interface RouterConfig {
  enabled: boolean;
  /** "weighted" (default) or "round_robin" or "lowest_cost". */
  strategy: "weighted" | "round_robin" | "lowest_cost";
  /** Global max spend ($USD) per day across all providers. 0 = unlimited. */
  globalSpendLimitDaily?: number;
  /** Fallback to any available provider if all configured routes are exhausted. */
  fallbackToAny: boolean;
  /** Per-provider route configs keyed by providerId. */
  routes: Record<string, ProviderRouteConfig>;
}

export interface RouterUsageRecord {
  providerId: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  success: boolean;
}

export interface ProviderAvailability {
  providerId: string;
  weight: number;
  enabled: boolean;
  requestsIn5hWindow: number;
  requestsInWeekWindow: number;
  spendToday: number;
  spendThisWeek: number;
  /** True if all limits are satisfied. */
  available: boolean;
  reason?: string;
}

// --- State ---

const usageLog: RouterUsageRecord[] = [];
const MAX_USAGE_RECORDS = 10_000;
let roundRobinIndex = 0;

const WINDOW_5H_MS = 5 * 60 * 60 * 1000;
const WINDOW_DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// --- Config ---

const DEFAULT_ROUTE: ProviderRouteConfig = {
  weight: 50,
  enabled: true,
};

function getRouterConfig(): RouterConfig {
  const cfg = config.get<RouterConfig>("router");
  if (!cfg) {
    return { enabled: false, strategy: "weighted", fallbackToAny: true, routes: {} };
  }
  return {
    enabled: cfg.enabled ?? false,
    strategy: cfg.strategy ?? "weighted",
    globalSpendLimitDaily: cfg.globalSpendLimitDaily ?? 0,
    fallbackToAny: cfg.fallbackToAny ?? true,
    routes: cfg.routes ?? {},
  };
}

// --- Availability computation ---

function getWindowedRequests(providerId: string, windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return usageLog.filter((r) => r.providerId === providerId && r.timestamp >= cutoff).length;
}

function getWindowedSpend(providerId: string | null, windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return usageLog
    .filter((r) => (providerId === null || r.providerId === providerId) && r.timestamp >= cutoff)
    .reduce((sum, r) => sum + r.estimatedCost, 0);
}

export function getProviderAvailability(providerId: string): ProviderAvailability {
  const routerCfg = getRouterConfig();
  const route = routerCfg.routes[providerId] ?? DEFAULT_ROUTE;
  const requests5h = getWindowedRequests(providerId, WINDOW_5H_MS);
  const requestsWeek = getWindowedRequests(providerId, WINDOW_WEEK_MS);
  const spendToday = getWindowedSpend(providerId, WINDOW_DAY_MS);
  const spendWeek = getWindowedSpend(providerId, WINDOW_WEEK_MS);

  const enabled = route.enabled !== false;
  let available = enabled;
  let reason: string | undefined;

  if (route.limit5h && route.limit5h > 0 && requests5h >= route.limit5h) {
    available = false;
    reason = `5h rate limit reached (${requests5h}/${route.limit5h})`;
  }
  if (route.limitWeekly && route.limitWeekly > 0 && requestsWeek >= route.limitWeekly) {
    available = false;
    reason = `Weekly rate limit reached (${requestsWeek}/${route.limitWeekly})`;
  }
  if (route.spendLimitDaily && route.spendLimitDaily > 0 && spendToday >= route.spendLimitDaily) {
    available = false;
    reason = `Daily spend limit reached ($${spendToday.toFixed(2)}/$${route.spendLimitDaily})`;
  }
  if (route.spendLimitWeekly && route.spendLimitWeekly > 0 && spendWeek >= route.spendLimitWeekly) {
    available = false;
    reason = `Weekly spend limit reached ($${spendWeek.toFixed(2)}/$${route.spendLimitWeekly})`;
  }

  // Check global spend limit.
  if (routerCfg.globalSpendLimitDaily && routerCfg.globalSpendLimitDaily > 0) {
    const globalToday = getWindowedSpend(null, WINDOW_DAY_MS);
    if (globalToday >= routerCfg.globalSpendLimitDaily) {
      available = false;
      reason = `Global daily spend limit reached ($${globalToday.toFixed(2)}/$${routerCfg.globalSpendLimitDaily})`;
    }
  }

  return {
    providerId,
    weight: route.weight,
    enabled,
    requestsIn5hWindow: requests5h,
    requestsInWeekWindow: requestsWeek,
    spendToday,
    spendThisWeek: spendWeek,
    available,
    reason,
  };
}

// --- Selection ---

/**
 * Select the best provider for the next request based on the configured strategy
 * and availability. Returns null if no provider is available.
 */
export function selectProvider(
  preferredProviderId?: string
): string | null {
  const routerCfg = getRouterConfig();

  // If router is disabled, pass through the preferred/default.
  if (!routerCfg.enabled) {
    return preferredProviderId ?? null;
  }

  // If a specific provider is preferred AND available, use it.
  if (preferredProviderId) {
    const avail = getProviderAvailability(preferredProviderId);
    if (avail.available) return preferredProviderId;
  }

  // Get all configured route provider IDs that are available.
  const configuredIds = Object.keys(routerCfg.routes);
  const candidates: Array<{ id: string; availability: ProviderAvailability }> = [];

  for (const id of configuredIds) {
    const avail = getProviderAvailability(id);
    if (avail.available) {
      candidates.push({ id, availability: avail });
    }
  }

  // Fallback: if no configured routes are available and fallbackToAny is set,
  // consider all configured providers.
  if (candidates.length === 0 && routerCfg.fallbackToAny) {
    const allProviders = providerManager.list();
    for (const p of allProviders) {
      if (p.provider && !configuredIds.includes(p.provider)) {
        const avail = getProviderAvailability(p.provider);
        if (avail.available) {
          candidates.push({ id: p.provider, availability: avail });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  // Apply strategy.
  switch (routerCfg.strategy) {
    case "round_robin": {
      const selected = candidates[roundRobinIndex % candidates.length];
      roundRobinIndex += 1;
      return selected.id;
    }
    case "lowest_cost": {
      // Sort by price (input + output) ascending.
      candidates.sort((a, b) => {
        const priceA =
          (routerCfg.routes[a.id]?.priceInputPerM ?? 0) +
          (routerCfg.routes[a.id]?.priceOutputPerM ?? 0);
        const priceB =
          (routerCfg.routes[b.id]?.priceInputPerM ?? 0) +
          (routerCfg.routes[b.id]?.priceOutputPerM ?? 0);
        return priceA - priceB;
      });
      return candidates[0].id;
    }
    case "weighted":
    default: {
      // Weighted random selection.
      const totalWeight = candidates.reduce((sum, c) => sum + c.availability.weight, 0);
      if (totalWeight <= 0) return candidates[0].id;
      let roll = Math.random() * totalWeight;
      for (const c of candidates) {
        roll -= c.availability.weight;
        if (roll <= 0) return c.id;
      }
      return candidates[candidates.length - 1].id;
    }
  }
}

// --- Usage recording ---

export function recordUsage(
  providerId: string,
  inputTokens: number,
  outputTokens: number,
  success: boolean
): void {
  const routerCfg = getRouterConfig();
  const route = routerCfg.routes[providerId];
  const priceIn = route?.priceInputPerM ?? 0;
  const priceOut = route?.priceOutputPerM ?? 0;
  const estimatedCost = (inputTokens / 1_000_000) * priceIn + (outputTokens / 1_000_000) * priceOut;

  usageLog.push({
    providerId,
    timestamp: Date.now(),
    inputTokens,
    outputTokens,
    estimatedCost,
    success,
  });

  // Prune old records.
  if (usageLog.length > MAX_USAGE_RECORDS) {
    usageLog.splice(0, usageLog.length - MAX_USAGE_RECORDS);
  }
}

// --- Inspection (for UI + CLI) ---

export interface RouterStatus {
  enabled: boolean;
  strategy: string;
  globalSpendToday: number;
  globalSpendLimitDaily: number | undefined;
  routes: Array<ProviderAvailability & {
    priceInputPerM?: number;
    priceOutputPerM?: number;
  }>;
}

export function getRouterStatus(): RouterStatus {
  const cfg = getRouterConfig();
  const routeIds = Object.keys(cfg.routes);
  const routes = routeIds.map((id) => {
    const avail = getProviderAvailability(id);
    return {
      ...avail,
      priceInputPerM: cfg.routes[id]?.priceInputPerM,
      priceOutputPerM: cfg.routes[id]?.priceOutputPerM,
    };
  });
  return {
    enabled: cfg.enabled,
    strategy: cfg.strategy,
    globalSpendToday: getWindowedSpend(null, WINDOW_DAY_MS),
    globalSpendLimitDaily: cfg.globalSpendLimitDaily,
    routes,
  };
}

/** Reset usage state (for tests). */
export function resetRouterForTests(): void {
  usageLog.length = 0;
  roundRobinIndex = 0;
}
