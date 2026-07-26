import { config } from "./config";
import { providerManager } from "./providers";
import { tables } from "./database";
import { redactSecrets } from "./redaction";
import {
  createProviderPlanEvaluationContext,
  getLiveProviderPlanRouteConstraint,
  getProviderPlanRouteConstraint,
  hasProviderPlanRouteConstraints,
  type ProviderPlanEvaluationContext,
  type ProviderPlanRouteConstraint,
} from "./provider-plans";
import {
  getProviderAccountPool,
  parseProviderAccountPoolRouteId,
  providerAccountPoolRouteProvider,
} from "./provider-account-pool";

type PricingEntry = [
  provider: string,
  model: string,
  inputPerM: number,
  outputPerM: number,
  cacheReadPerM?: number,
  cacheWritePerM?: number,
];

const PROVIDER_PRICING: readonly PricingEntry[] = [
  ["openai", "gpt-5.6-sol", 5.0, 30.0, 0.5, 6.25],
  ["openai", "gpt-5.6", 5.0, 30.0, 0.5, 6.25],
  ["openai", "gpt-5.6-terra", 2.5, 15.0, 0.25, 3.125],
  ["openai", "gpt-5.6-luna", 1.0, 6.0, 0.1, 1.25],
  ["openai-codex", "gpt-5.6-sol", 5.0, 30.0, 0.5, 6.25],
  ["openai-codex", "gpt-5.6-terra", 2.5, 15.0, 0.25, 3.125],
  ["openai-codex", "gpt-5.6-luna", 1.0, 6.0, 0.1, 1.25],
  ["openai", "gpt-5.5", 5.0, 30.0, 0.5, 6.25],
  ["openai", "gpt-5.5-pro", 8.0, 32.0, 2.0],
  ["openai", "gpt-5.4", 2.5, 15.0, 0.25, 3.125],
  ["openai", "gpt-5.4-mini", 0.4, 1.6, 0.1],
  ["openai", "gpt-5.4-nano", 0.2, 0.8, 0.05],
  ["openai", "gpt-5.4-pro", 5.0, 20.0, 1.25],
  ["openai", "gpt-5.2", 1.5, 6.0, 0.38],
  ["openai", "gpt-5.1", 2.0, 8.0, 0.5],

  ["anthropic", "claude-opus-4-8", 5.0, 25.0, 0.5, 6.25],
  ["anthropic", "claude-opus-4-7", 5.0, 25.0, 0.5, 6.25],
  ["anthropic", "claude-opus-4-6", 5.0, 25.0, 0.5, 6.25],
  ["anthropic", "claude-sonnet-4-6", 3.0, 15.0, 0.3, 3.75],
  ["anthropic", "claude-haiku-4-5", 1.0, 5.0, 0.1, 1.25],
  ["anthropic", "claude-fable-5", 5.0, 25.0, 0.5, 6.25],

  ["google", "gemini-3.1-pro-preview", 2.0, 12.0],
  ["google", "gemini-3.5-flash", 0.3, 1.2],
  ["google", "gemini-2.5-pro", 1.25, 10.0],
  ["google", "gemini-2.5-flash", 0.15, 0.6],
  ["google", "gemini-2.5-flash-lite", 0.075, 0.3],

  ["xai", "grok-4.3", 1.25, 2.5, 0.125],
  ["xai", "grok-4.20-0309-reasoning", 1.25, 2.5, 0.125],
  ["xai", "grok-4.20-0309-non-reasoning", 1.25, 2.5, 0.125],
  ["xai", "grok-4.20-multi-agent-0309", 1.25, 2.5, 0.125],
  ["xai", "grok-4.5", 2.0, 6.0, 0.5],
  ["xai-oauth", "grok-4.5", 2.0, 6.0, 0.5],
  ["xai-oauth", "grok-4.20-0309-reasoning", 1.25, 2.5, 0.125],
  ["xai-oauth", "grok-4.20-0309-non-reasoning", 1.25, 2.5, 0.125],
  ["xai-oauth", "grok-4.20-multi-agent-0309", 1.25, 2.5, 0.125],
  ["xai", "grok-4", 3.0, 15.0],
  ["xai", "grok-4-fast", 0.2, 1.5],

  ["deepseek", "deepseek-v4-pro", 1.74, 3.48, 0.0145],
  ["deepseek", "deepseek-v4-flash", 0.3, 0.6],
  ["deepseek", "deepseek-chat", 0.14, 0.28],
  ["deepseek", "deepseek-reasoner", 0.14, 0.28],

  ["z.ai", "glm-5.2", 1.0, 1.0],
  ["z.ai", "glm-5.1", 0.8, 0.8],
  ["z.ai", "glm-5", 0.6, 0.6],
  ["z.ai", "glm-4.7", 0.6, 0.6],

  ["minimax", "MiniMax-M3", 0.5, 2.0],
  ["minimax", "MiniMax-M2.7", 0.3, 1.2],

  ["moonshot", "kimi-k2.6", 1.2, 8.0],
  ["moonshot", "kimi-k2.5", 0.6, 2.5],

  ["mistral", "mistral-large-latest", 2.0, 6.0],
  ["mistral", "devstral-medium-latest", 0.4, 1.2],
  ["mistral", "mistral-small-latest", 0.2, 0.6],

  ["together", "moonshotai/Kimi-K2.6", 1.3, 8.8],
  ["groq", "llama-3.3-70b-versatile", 0.59, 0.79],

  ["openrouter", "anthropic/claude-opus-4-8", 5.0, 25.0],
  ["openrouter", "openai/gpt-5.4", 2.5, 10.0],
];

export function getPricing(
  providerId: string,
  modelId?: string
): {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
} | null {
  const exact = PROVIDER_PRICING.find(
    ([p, m]) => p === providerId && (modelId ? m === modelId : true)
  );
  if (exact) {
    return {
      inputPerM: exact[2],
      outputPerM: exact[3],
      cacheReadPerM: exact[4],
      cacheWritePerM: exact[5],
    };
  }
  const providerMatch = PROVIDER_PRICING.find(([p]) => p === providerId);
  if (providerMatch) {
    return {
      inputPerM: providerMatch[2],
      outputPerM: providerMatch[3],
      cacheReadPerM: providerMatch[4],
      cacheWritePerM: providerMatch[5],
    };
  }
  return null;
}

export function getAllPricing(): PricingEntry[] {
  return [...PROVIDER_PRICING];
}

export interface ProviderRouteConfig {
  weight: number;
  priority?: number;
  limit5h?: number;
  limitWeekly?: number;
  spendLimitDaily?: number;
  spendLimitWeekly?: number;
  priceInputPerM?: number;
  priceOutputPerM?: number;
  enabled?: boolean;
  model?: string;
}

export type RouterStrategy =
  | "weighted"
  | "round_robin"
  | "lowest_cost"
  | "priority"
  | "mixture_of_agents"
  | "usage_aware";

export interface RouterConfig {
  enabled: boolean;
  strategy: RouterStrategy;
  globalSpendLimitDaily?: number;
  fallbackToAny: boolean;
  routes: Record<string, ProviderRouteConfig>;
  moaMaxAgents?: number;
  moaAggregatorAgentId?: string;
}

const ROUTER_STRATEGIES: readonly RouterStrategy[] = [
  "weighted",
  "round_robin",
  "lowest_cost",
  "priority",
  "mixture_of_agents",
  "usage_aware",
];

export function normalizeRouterStrategy(value: unknown): RouterStrategy {
  return typeof value === "string" && (ROUTER_STRATEGIES as readonly string[]).includes(value)
    ? (value as RouterStrategy)
    : "weighted";
}

export interface RouterUsageRecord {
  providerId: string;
  model?: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  success: boolean;
}

export interface ProviderAvailability {
  providerId: string;
  providerType?: string;
  targetName?: string;
  targetType?: "provider" | "pool";
  weight: number;
  priority: number;
  enabled: boolean;
  available: boolean;
  reason?: string;
  requestsIn5hWindow: number;
  requestsInWeekWindow: number;
  spendToday: number;
  spendThisWeek: number;
  inputPerM?: number;
  outputPerM?: number;
  circuitOpen: boolean;
  inCooldown: boolean;
  plan?: ProviderPlanRouteConstraint;
}

const usageLog: RouterUsageRecord[] = [];
const MAX_USAGE_RECORDS = 10_000;
let roundRobinIndex = 0;

const circuitState = new Map<string, { consecutiveFailures: number; openUntil: number }>();
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RECOVERY_MS = 60_000;

const cooldownUntil = new Map<string, number>();

const WINDOW_5H_MS = 5 * 60 * 60 * 1000;
const WINDOW_DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getRouterConfig(): RouterConfig {
  const cfg = config.get<RouterConfig>("router");
  if (!cfg)
    return {
      enabled: false,
      strategy: "weighted",
      fallbackToAny: true,
      routes: {},
    };
  return {
    enabled: cfg.enabled === true,
    strategy: normalizeRouterStrategy(cfg.strategy),
    globalSpendLimitDaily: Math.max(0, cfg.globalSpendLimitDaily ?? 0),
    fallbackToAny: cfg.fallbackToAny ?? true,
    routes: cfg.routes ?? {},
    moaMaxAgents:
      typeof cfg.moaMaxAgents === "number" && cfg.moaMaxAgents >= 1
        ? Math.floor(cfg.moaMaxAgents)
        : undefined,
    moaAggregatorAgentId:
      typeof cfg.moaAggregatorAgentId === "string" ? cfg.moaAggregatorAgentId : undefined,
  };
}

export function isModelRouterEnabled(): boolean {
  return getRouterConfig().enabled;
}

export function isMixtureOfAgentsRoutingActive(): boolean {
  const cfg = getRouterConfig();
  return cfg.enabled === true && cfg.strategy === "mixture_of_agents";
}

export function getMixtureOfAgentsRoutingConfig(): {
  maxAgents?: number;
  aggregatorAgentId?: string;
} {
  const cfg = getRouterConfig();
  return {
    maxAgents: cfg.moaMaxAgents,
    aggregatorAgentId: cfg.moaAggregatorAgentId,
  };
}

function normalizeRoute(route: ProviderRouteConfig): ProviderRouteConfig {
  return {
    weight: Math.max(0, Math.min(100, route.weight ?? 50)),
    priority: Math.max(0, Math.min(2, route.priority ?? 0)),
    limit5h: Math.max(0, route.limit5h ?? 0),
    limitWeekly: Math.max(0, route.limitWeekly ?? 0),
    spendLimitDaily: Math.max(0, route.spendLimitDaily ?? 0),
    spendLimitWeekly: Math.max(0, route.spendLimitWeekly ?? 0),
    priceInputPerM:
      route.priceInputPerM !== undefined ? Math.max(0, route.priceInputPerM) : undefined,
    priceOutputPerM:
      route.priceOutputPerM !== undefined ? Math.max(0, route.priceOutputPerM) : undefined,
    enabled: route.enabled ?? true,
    model: route.model,
  };
}

function getWindowedRequests(providerId: string, windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  let count = 0;
  for (let i = usageLog.length - 1; i >= 0; i--) {
    const r = usageLog[i];
    if (r.timestamp < cutoff) break;
    if (r.providerId === providerId) count++;
  }
  return count;
}

function getWindowedSpend(providerId: string | null, windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  let sum = 0;
  for (let i = usageLog.length - 1; i >= 0; i--) {
    const r = usageLog[i];
    if (r.timestamp < cutoff) break;
    if (providerId === null || r.providerId === providerId) {
      sum += Math.max(0, r.estimatedCost);
    }
  }
  return sum;
}

function isCircuitOpen(providerId: string): boolean {
  const state = circuitState.get(providerId);
  if (!state) return false;
  if (state.openUntil > 0 && Date.now() < state.openUntil) return true;
  return false;
}

export function recordProviderFailure(providerId: string, reason?: string): void {
  const state = circuitState.get(providerId) ?? {
    consecutiveFailures: 0,
    openUntil: 0,
  };
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_RECOVERY_MS;
    console.warn(
      `[Router] Circuit opened for ${providerId} after ${state.consecutiveFailures} failures${reason ? ` (${reason})` : ""}`
    );
  }
  circuitState.set(providerId, state);
}

export function recordProviderSuccess(providerId: string): void {
  circuitState.set(providerId, { consecutiveFailures: 0, openUntil: 0 });
}

export function setProviderCooldown(providerId: string, cooldownMs: number): void {
  cooldownUntil.set(providerId, Date.now() + cooldownMs);
}

function isInCooldown(providerId: string): boolean {
  const until = cooldownUntil.get(providerId);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldownUntil.delete(providerId);
    return false;
  }
  return true;
}

function resolvePrice(
  route: ProviderRouteConfig,
  providerId: string
): {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
} {
  const builtIn = getPricing(providerId, route.model);
  if (route.priceInputPerM !== undefined && route.priceOutputPerM !== undefined) {
    return {
      inputPerM: route.priceInputPerM,
      outputPerM: route.priceOutputPerM,
      cacheReadPerM: builtIn?.cacheReadPerM,
      cacheWritePerM: builtIn?.cacheWritePerM,
    };
  }
  return {
    inputPerM: builtIn?.inputPerM ?? 0,
    outputPerM: builtIn?.outputPerM ?? 0,
    cacheReadPerM: builtIn?.cacheReadPerM,
    cacheWritePerM: builtIn?.cacheWritePerM,
  };
}

export function getProviderAvailability(
  providerId: string,
  planContext?: ProviderPlanEvaluationContext,
  planOverride?: ProviderPlanRouteConstraint
): ProviderAvailability {
  const poolId = parseProviderAccountPoolRouteId(providerId);
  const pool = poolId ? getProviderAccountPool(poolId) : undefined;
  const providerType = pool?.provider ?? providerId;
  const routerCfg = getRouterConfig();
  const route = normalizeRoute(routerCfg.routes[providerId] ?? { weight: 50, enabled: true });
  const requests5h = getWindowedRequests(providerId, WINDOW_5H_MS);
  const requestsWeek = getWindowedRequests(providerId, WINDOW_WEEK_MS);
  const spendToday = getWindowedSpend(providerId, WINDOW_DAY_MS);
  const spendWeek = getWindowedSpend(providerId, WINDOW_WEEK_MS);
  const price = resolvePrice(route, providerType);
  const circuitOpen = isCircuitOpen(providerId);
  const inCooldown = isInCooldown(providerId);
  const plan = planOverride ?? getProviderPlanRouteConstraint(providerId, planContext);

  let available = route.enabled !== false;
  let reason: string | undefined;

  if (poolId && (!pool?.enabled || pool.accounts.length === 0)) {
    available = false;
    reason = pool ? "Provider pool is disabled" : "Provider pool not found";
  }

  if (circuitOpen) {
    available = false;
    reason = "Circuit breaker open (too many failures)";
  }
  if (inCooldown) {
    available = false;
    reason = "Rate-limit cooldown";
  }
  const limit5h = route.limit5h ?? 0;
  const limitWeekly = route.limitWeekly ?? 0;
  const spendDaily = route.spendLimitDaily ?? 0;
  const spendWeekly = route.spendLimitWeekly ?? 0;
  if (limit5h > 0 && requests5h >= limit5h) {
    available = false;
    reason = `5h rate limit (${requests5h}/${limit5h})`;
  }
  if (limitWeekly > 0 && requestsWeek >= limitWeekly) {
    available = false;
    reason = `Weekly rate limit (${requestsWeek}/${limitWeekly})`;
  }
  if (spendDaily > 0 && spendToday >= spendDaily) {
    available = false;
    reason = `Daily spend ($${spendToday.toFixed(2)}/$${spendDaily})`;
  }
  if (spendWeekly > 0 && spendWeek >= spendWeekly) {
    available = false;
    reason = `Weekly spend ($${spendWeek.toFixed(2)}/$${spendWeekly})`;
  }
  if (plan.enforced) {
    available = false;
    reason = plan.reason || "Provider plan exhausted";
  }

  const globalLimit = routerCfg.globalSpendLimitDaily;
  const globalToday = getWindowedSpend(null, WINDOW_DAY_MS);
  if (globalLimit !== undefined && globalLimit > 0 && globalToday >= globalLimit) {
    available = false;
    reason = `Global daily spend ($${globalToday.toFixed(2)}/$${globalLimit})`;
  }

  return {
    providerId,
    providerType,
    targetName: pool?.name,
    targetType: pool ? "pool" : "provider",
    weight: route.weight,
    priority: route.priority ?? 0,
    enabled: route.enabled !== false,
    available,
    reason,
    requestsIn5hWindow: requests5h,
    requestsInWeekWindow: requestsWeek,
    spendToday,
    spendThisWeek: spendWeek,
    inputPerM: price.inputPerM,
    outputPerM: price.outputPerM,
    circuitOpen,
    inCooldown,
    plan,
  };
}

interface RouterSelectionTargets {
  routeIds: string[];
  preferredRouteId?: string;
  fallbackProviderIds: string[];
  planRouteKeys: string[];
}

function resolveRouterSelectionTargets(
  routerCfg: RouterConfig,
  preferredProviderId?: string
): RouterSelectionTargets {
  const routeIds = Object.keys(routerCfg.routes);
  const preferredProvider = preferredProviderId
    ? providerManager.getWithCredentials(preferredProviderId)
    : undefined;
  const preferredRouteId = [preferredProviderId, preferredProvider?.provider].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate in routerCfg.routes
  );
  const fallbackProviderIds = routerCfg.fallbackToAny
    ? providerManager
        .list()
        .map((provider) => provider.provider)
        .filter((provider): provider is string => Boolean(provider))
    : [];
  const planRouteKeys = [
    preferredRouteId,
    ...routeIds,
    ...fallbackProviderIds.filter((id) => !routerCfg.routes[id]),
  ].filter((id): id is string => Boolean(id));
  return { routeIds, preferredRouteId, fallbackProviderIds, planRouteKeys };
}

function chooseProviderCandidate(
  candidates: Array<{ id: string; avail: ProviderAvailability }>,
  strategy: RouterStrategy
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  switch (strategy) {
    case "priority": {
      candidates.sort(
        (a, b) => a.avail.priority - b.avail.priority || b.avail.weight - a.avail.weight
      );
      return candidates[0].id;
    }
    case "round_robin": {
      const selected = candidates[roundRobinIndex % candidates.length];
      roundRobinIndex = (roundRobinIndex + 1) % candidates.length;
      return selected.id;
    }
    case "lowest_cost": {
      const priced = candidates.filter(
        (candidate) => (candidate.avail.inputPerM ?? 0) + (candidate.avail.outputPerM ?? 0) > 0
      );
      const pool = priced.length > 0 ? priced : candidates;
      pool.sort(
        (a, b) =>
          (a.avail.inputPerM ?? 0) +
          (a.avail.outputPerM ?? 0) -
          ((b.avail.inputPerM ?? 0) + (b.avail.outputPerM ?? 0))
      );
      return pool[0].id;
    }
    case "usage_aware": {
      const remainingFor = (candidate: { avail: ProviderAvailability }): number | undefined => {
        if (candidate.avail.plan?.status === "exhausted") return -1;
        return candidate.avail.plan?.primaryRemainingPercent;
      };
      candidates.sort((left, right) => {
        const leftRemaining = remainingFor(left);
        const rightRemaining = remainingFor(right);
        if (leftRemaining !== undefined || rightRemaining !== undefined) {
          if (leftRemaining === undefined) return 1;
          if (rightRemaining === undefined) return -1;
          if (leftRemaining !== rightRemaining) return rightRemaining - leftRemaining;
        }
        return right.avail.weight - left.avail.weight;
      });
      return candidates[0].id;
    }
    case "weighted":
    default: {
      const planWeight = (candidate: { avail: ProviderAvailability }): number =>
        candidate.avail.plan?.status === "warning"
          ? candidate.avail.weight * 0.25
          : candidate.avail.weight;
      const positiveWeight = candidates.filter((candidate) => planWeight(candidate) > 0);
      const pool = positiveWeight.length > 0 ? positiveWeight : candidates;
      const totalWeight = pool.reduce((sum, candidate) => sum + planWeight(candidate), 0);
      if (totalWeight <= 0) return pool[0].id;
      let roll = Math.random() * totalWeight;
      for (const candidate of pool) {
        roll -= planWeight(candidate);
        if (roll <= 0) return candidate.id;
      }
      return pool[pool.length - 1].id;
    }
  }
}

function availableCandidates(
  routeIds: string[],
  fallbackProviderIds: string[],
  routerCfg: RouterConfig,
  availability: Map<string, ProviderAvailability>
): Array<{ id: string; avail: ProviderAvailability }> {
  const configured = routeIds.flatMap((id) => {
    const avail = availability.get(id);
    return avail?.available ? [{ id, avail }] : [];
  });
  if (configured.length > 0 || !routerCfg.fallbackToAny) return configured;
  return fallbackProviderIds.flatMap((id) => {
    if (routerCfg.routes[id]) return [];
    const avail = availability.get(id);
    return avail?.available ? [{ id, avail }] : [];
  });
}

export function selectProvider(preferredProviderId?: string): string | null {
  const routerCfg = getRouterConfig();
  if (!routerCfg.enabled) return preferredProviderId ?? null;
  const targets = resolveRouterSelectionTargets(routerCfg, preferredProviderId);
  const planContext = hasProviderPlanRouteConstraints(targets.planRouteKeys)
    ? createProviderPlanEvaluationContext()
    : undefined;
  const availability = new Map(
    targets.planRouteKeys.map((id) => [id, getProviderAvailability(id, planContext)])
  );
  if (targets.preferredRouteId && availability.get(targets.preferredRouteId)?.available) {
    return targets.preferredRouteId;
  }
  return chooseProviderCandidate(
    availableCandidates(targets.routeIds, targets.fallbackProviderIds, routerCfg, availability),
    routerCfg.strategy
  );
}

export async function selectProviderWithLiveUsage(
  preferredProviderId?: string
): Promise<string | null> {
  const routerCfg = getRouterConfig();
  if (!routerCfg.enabled) return preferredProviderId ?? null;
  const targets = resolveRouterSelectionTargets(routerCfg, preferredProviderId);
  const planContext = createProviderPlanEvaluationContext();
  const availability = new Map(
    await Promise.all(
      targets.planRouteKeys.map(async (id) => {
        const localPlan = getProviderPlanRouteConstraint(id, planContext);
        const livePlan = await Promise.race([
          getLiveProviderPlanRouteConstraint(id, planContext),
          Bun.sleep(750).then(() => localPlan),
        ]);
        return [id, getProviderAvailability(id, planContext, livePlan)] as const;
      })
    )
  );
  if (targets.preferredRouteId && availability.get(targets.preferredRouteId)?.available) {
    return targets.preferredRouteId;
  }
  return chooseProviderCandidate(
    availableCandidates(targets.routeIds, targets.fallbackProviderIds, routerCfg, availability),
    routerCfg.strategy
  );
}

export function getRouterRouteModel(providerId?: string): string | undefined {
  if (!providerId) return undefined;
  const routerCfg = getRouterConfig();
  const route = routerCfg.routes[providerId];
  return route ? normalizeRoute(route).model : undefined;
}

function usageTokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function recordUsage(
  providerId: string,
  inputTokens: number,
  outputTokens: number,
  success: boolean,
  model?: string,
  providerType?: string,
  cache?: { readTokens?: number; writeTokens?: number }
): void {
  const routerCfg = getRouterConfig();
  const route = routerCfg.routes[providerId] ? normalizeRoute(routerCfg.routes[providerId]) : null;
  const pricingProviderId =
    providerType ?? providerAccountPoolRouteProvider(providerId) ?? providerId;
  const builtInPrice = getPricing(pricingProviderId, model);
  const price = route
    ? resolvePrice(route, pricingProviderId)
    : {
        inputPerM: builtInPrice?.inputPerM ?? 0,
        outputPerM: builtInPrice?.outputPerM ?? 0,
        cacheReadPerM: builtInPrice?.cacheReadPerM,
        cacheWritePerM: builtInPrice?.cacheWritePerM,
      };

  const normalizedInputTokens = usageTokenCount(inputTokens);
  const normalizedOutputTokens = usageTokenCount(outputTokens);
  const cacheReadTokens = Math.min(normalizedInputTokens, usageTokenCount(cache?.readTokens));
  const cacheWriteTokens = Math.min(
    normalizedInputTokens - cacheReadTokens,
    usageTokenCount(cache?.writeTokens)
  );
  const regularInputTokens = Math.max(
    0,
    normalizedInputTokens - cacheReadTokens - cacheWriteTokens
  );

  const estimatedCost =
    (regularInputTokens / 1_000_000) * price.inputPerM +
    (cacheReadTokens / 1_000_000) * (price.cacheReadPerM ?? price.inputPerM) +
    (cacheWriteTokens / 1_000_000) * (price.cacheWritePerM ?? price.inputPerM) +
    (normalizedOutputTokens / 1_000_000) * price.outputPerM;

  const record: RouterUsageRecord = {
    providerId,
    model,
    timestamp: Date.now(),
    inputTokens: normalizedInputTokens,
    outputTokens: normalizedOutputTokens,
    estimatedCost,
    success,
  };
  usageLog.push(record);
  if (usageLog.length > MAX_USAGE_RECORDS) usageLog.splice(0, usageLog.length - MAX_USAGE_RECORDS);

  try {
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "router_usage",
      key: providerId,
      value: estimatedCost,
      metadata: JSON.stringify(
        redactSecrets({
          inputTokens: normalizedInputTokens,
          outputTokens: normalizedOutputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          success,
          model,
        })
      ),
    });
  } catch {}

  if (success) recordProviderSuccess(providerId);
  else recordProviderFailure(providerId);
}

export function recordRateLimit(providerId: string, retryAfterMs: number): void {
  setProviderCooldown(providerId, Math.max(retryAfterMs, 10_000));
  recordProviderFailure(providerId, "rate_limit");
}

export interface RouterStatus {
  enabled: boolean;
  strategy: string;
  globalSpendToday: number;
  globalSpendLimitDaily?: number;
  routes: ProviderAvailability[];
  totalRequests: number;
}

export function getRouterStatus(): RouterStatus {
  const cfg = getRouterConfig();
  const routeIds = Object.keys(cfg.routes);
  const planContext = hasProviderPlanRouteConstraints(routeIds)
    ? createProviderPlanEvaluationContext()
    : undefined;
  return {
    enabled: cfg.enabled,
    strategy: cfg.strategy,
    globalSpendToday: getWindowedSpend(null, WINDOW_DAY_MS),
    globalSpendLimitDaily: cfg.globalSpendLimitDaily,
    routes: routeIds.map((id) => getProviderAvailability(id, planContext)),
    totalRequests: usageLog.length,
  };
}

export function resetRouterForTests(): void {
  usageLog.length = 0;
  roundRobinIndex = 0;
  circuitState.clear();
  cooldownUntil.clear();
}
