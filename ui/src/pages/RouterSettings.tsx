import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  Settings2,
  DollarSign,
  Activity,
  ToggleLeft,
  ToggleRight,
  Plus,
  Cpu,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth";

interface RouteStatus {
  providerId: string;
  weight: number;
  enabled: boolean;
  available: boolean;
  reason?: string;
  requestsIn5hWindow: number;
  requestsInWeekWindow: number;
  spendToday: number;
  spendThisWeek: number;
  priceInputPerM?: number;
  priceOutputPerM?: number;
  plan?: ProviderPlanRouteConstraint;
}

interface RouterStatus {
  enabled: boolean;
  strategy: string;
  globalSpendToday: number;
  globalSpendLimitDaily?: number;
  routes: RouteStatus[];
}

interface RouterConfig {
  enabled: boolean;
  strategy: "weighted" | "round_robin" | "lowest_cost" | "priority" | "mixture_of_agents";
  globalSpendLimitDaily?: number;
  fallbackToAny: boolean;
  routes: Record<string, Record<string, unknown>>;
  moaMaxAgents?: number;
  moaAggregatorAgentId?: string;
}

interface ProviderMeta {
  id?: string;
  type: string;
  name: string;
  models: string[];
}

interface ProviderPlanRouteConstraint {
  monitored: boolean;
  configured: boolean;
  enforced: boolean;
  status: "ok" | "warning" | "exhausted" | "unconfigured" | "disabled";
  reason?: string;
  primaryRemainingPercent?: number;
}

interface ProviderPlanWindow {
  id: string;
  title: string;
  kind: "rolling_5h" | "rolling_week" | "billing_month";
  usedTokens: number;
  tokenLimit?: number;
  usedSpend: number;
  spendLimit?: number;
  usedPercent?: number;
  remainingPercent?: number;
  resetsAt?: string;
  resetDescription: string;
  usageKnown: boolean;
  unlimited?: boolean;
}

interface ProviderPlanPresetSuggestion {
  id: string;
  label: string;
  planName: string;
  description: string;
  confidence: "exact" | "published" | "dynamic" | "estimated";
  sourceMode: "local" | "provider_api" | "oauth_api" | "browser_cookie" | "cli" | "manual";
  sourceUrl?: string;
  limitDescription: string;
  monthlyTokenLimit?: number;
  monthlySpendLimit?: number;
  weeklyTokenLimit?: number;
  fiveHourTokenLimit?: number;
  routeLimit5h?: number;
  routeLimitWeekly?: number;
  externalSourceEnabled?: boolean;
}

interface ProviderPlanSnapshot {
  providerId: string;
  configuredProviderId?: string;
  providerType: string;
  providerName: string;
  monitored: boolean;
  managedAutomatically?: boolean;
  manualPlanEditable?: boolean;
  automaticTrackingLabel?: string;
  appliedPresetId?: string;
  planName?: string;
  status: "ok" | "warning" | "exhausted" | "unconfigured" | "disabled";
  reason?: string;
  localTokens30d: number;
  localSpend30d: number;
  windows: ProviderPlanWindow[];
  presetSuggestions?: ProviderPlanPresetSuggestion[];
}

interface ProviderPlanStatus {
  enabled: boolean;
  routerEnforcement: boolean;
  warningThresholdPct: number;
  providers: ProviderPlanSnapshot[];
  summary: {
    total: number;
    monitored: number;
    configured: number;
    warnings: number;
    exhausted: number;
  };
}

interface ProviderPlanWindowConfig {
  enabled?: boolean;
  tokenLimit?: number;
  spendLimit?: number;
}

interface ProviderPlanProviderConfig {
  enabled?: boolean;
  presetId?: string;
  planName?: string;
  sourceMode?: ProviderPlanPresetSuggestion["sourceMode"];
  externalSourceEnabled?: boolean;
  monthly?: ProviderPlanWindowConfig;
  weekly?: ProviderPlanWindowConfig;
  fiveHour?: ProviderPlanWindowConfig;
}

interface ProviderPlanConfig {
  enabled: boolean;
  routerEnforcement: boolean;
  warningThresholdPct: number;
  staleAfterMinutes: number;
  providers: Record<string, ProviderPlanProviderConfig>;
}

const STRATEGY_HELP: Record<RouterConfig["strategy"], string> = {
  weighted: "Spread requests across providers proportionally to each weight.",
  round_robin: "Rotate through providers evenly, one after another.",
  lowest_cost: "Always pick the cheapest available provider by token price.",
  priority: "Use the highest-priority provider first; fall back only when it is unavailable.",
  mixture_of_agents:
    "Fan each turn out to several proposer agents, then synthesize one answer with an aggregator agent.",
};

const STRATEGY_OPTIONS: Array<{
  value: RouterConfig["strategy"];
  label: string;
  costHint: string;
}> = [
  { value: "weighted", label: "Weighted", costHint: "Best when you want a blended plan." },
  { value: "round_robin", label: "Round robin", costHint: "Useful for even provider testing." },
  { value: "lowest_cost", label: "Lowest cost", costHint: "Uses your $/M token prices." },
  { value: "priority", label: "Priority", costHint: "Best for a primary subscription plan." },
  {
    value: "mixture_of_agents",
    label: "Mixture of agents",
    costHint: "Most powerful, highest spend risk.",
  },
];

const SELECT_CONTROL_CLASS =
  "rounded-lg bg-[#10121a] border border-white/10 px-3 py-2 text-sm text-white shadow-inner shadow-black/20 [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400/60";

function formatMoney(value: number | undefined, precision = 2): string {
  const num = Number.isFinite(value) ? Number(value) : 0;
  return `$${num.toFixed(precision)}`;
}

function formatTokenPrice(input?: number, output?: number): string {
  const hasInput = Number.isFinite(input) && Number(input) > 0;
  const hasOutput = Number.isFinite(output) && Number(output) > 0;
  if (!hasInput && !hasOutput) return "Pricing not set";
  return `${hasInput ? formatMoney(Number(input), 2) : "n/a"} in / ${
    hasOutput ? formatMoney(Number(output), 2) : "n/a"
  } out per 1M`;
}

function formatCompactNumber(value: number | undefined): string {
  const num = Number.isFinite(value) ? Number(value) : 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 1 : 2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(num >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(num));
}

function confidenceLabel(confidence: ProviderPlanPresetSuggestion["confidence"]): string {
  if (confidence === "exact") return "Exact";
  if (confidence === "published") return "Published";
  if (confidence === "dynamic") return "Dynamic";
  return "Estimated";
}

function presetLimitSummary(preset: ProviderPlanPresetSuggestion): string {
  if (preset.monthlyTokenLimit) return `${formatCompactNumber(preset.monthlyTokenLimit)} tokens/mo`;
  if (preset.monthlySpendLimit) return `${formatMoney(preset.monthlySpendLimit, 0)} credits/mo`;
  if (preset.routeLimitWeekly) return `${formatCompactNumber(preset.routeLimitWeekly)} req/week`;
  if (preset.routeLimit5h) return `${formatCompactNumber(preset.routeLimit5h)} req/5h`;
  return "Provider-managed";
}

function normalizedSpendLimit(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizedPositiveNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function RouterSettings() {
  const [status, setStatus] = useState<RouterStatus | null>(null);
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [planStatus, setPlanStatus] = useState<ProviderPlanStatus | null>(null);
  const [planConfig, setPlanConfig] = useState<ProviderPlanConfig | null>(null);
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/router/status");
      setStatus(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch("/api/router/config");
      setConfig(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlanStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/provider-plans/status");
      setPlanStatus(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  const fetchPlanConfig = useCallback(async () => {
    try {
      const res = await apiFetch("/api/provider-plans/config");
      setPlanConfig(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await apiFetch("/api/providers");
      const data = await res.json();
      const metas: ProviderMeta[] = [];
      const seen = new Set<string>();
      for (const p of Array.isArray(data) ? data : []) {
        const type: string = p.provider || p.type || p.id;
        if (!type || seen.has(type)) continue;
        const rawModels = Array.isArray(p.models)
          ? p.models
          : Array.isArray(p.info?.models)
            ? p.info.models
            : [];
        seen.add(type);
        metas.push({
          id: typeof p.id === "string" ? p.id : undefined,
          type,
          name: p.name || type,
          models: rawModels
            .map((model: unknown) =>
              typeof model === "string"
                ? model
                : model && typeof model === "object" && "id" in model
                  ? String((model as { id: unknown }).id)
                  : ""
            )
            .filter(Boolean),
        });
      }
      setProviders(metas);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await apiFetch("/api/agents");
      const data = await res.json();
      const list = Array.isArray(data) ? data : Array.isArray(data?.agents) ? data.agents : [];
      setAgents(
        list
          .filter((a: { id?: unknown }) => typeof a?.id === "string")
          .map((a: { id: string; name?: string }) => ({ id: a.id, name: a.name || a.id }))
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
    void fetchStatus();
    void fetchPlanStatus();
    void fetchPlanConfig();
    void fetchProviders();
    void fetchAgents();
    const statusInterval = setInterval(() => void fetchStatus(), 5000);
    const planInterval = setInterval(() => void fetchPlanStatus(), 15000);
    return () => {
      clearInterval(statusInterval);
      clearInterval(planInterval);
    };
  }, [fetchStatus, fetchConfig, fetchPlanStatus, fetchPlanConfig, fetchProviders, fetchAgents]);

  const [saveError, setSaveError] = useState<string | null>(null);

  const saveConfig = async (cfg: RouterConfig) => {
    setSaving(true);
    try {
      const res = await apiFetch("/api/router/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setConfig(cfg);
      setSaveError(null);
      await fetchStatus();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const savePlanConfig = async (cfg: ProviderPlanConfig) => {
    try {
      const res = await apiFetch("/api/provider-plans/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error(`Plan save failed (${res.status})`);
      const saved = await res.json();
      setPlanConfig(saved);
      setSaveError(null);
      await fetchPlanStatus();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Plan save failed");
    }
  };

  const providerName = (type: string) => providers.find((p) => p.type === type)?.name || type;
  const providerModels = (type: string) => providers.find((p) => p.type === type)?.models || [];

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </div>
    );
  }

  const routedTypes = Object.keys(config.routes);
  const unroutedProviders = providers.filter((p) => !routedTypes.includes(p.type));
  // Routing is only meaningful between at least two providers.
  const hasEnoughProviders = providers.length >= 2;
  const hasEnoughRoutes = routedTypes.length >= 2;
  const setupComplete = hasEnoughProviders && hasEnoughRoutes && config.enabled;
  const activeRoutes = status?.routes.filter((route) => route.enabled && route.available) || [];
  const dailyLimit = config.globalSpendLimitDaily ?? 0;
  const monthlyEquivalent = dailyLimit > 0 ? dailyLimit * 30 : 0;
  const spendToday = status?.globalSpendToday ?? 0;
  const budgetUsedPct = dailyLimit > 0 ? Math.min(100, (spendToday / dailyLimit) * 100) : 0;
  const pricedRoutes = status?.routes.filter(
    (route) => Number(route.priceInputPerM || 0) > 0 || Number(route.priceOutputPerM || 0) > 0
  );
  const configuredPricingCount = pricedRoutes?.length || 0;
  const planSummary = planStatus?.summary;
  const planStatusLoaded = planStatus !== null;
  const planConfigLoaded = planConfig !== null;
  const planMonitoringEnabled = planConfig?.enabled ?? true;
  const planEnforcementEnabled = planConfig?.routerEnforcement ?? true;
  const planByRoute = new Map<string, ProviderPlanSnapshot>();
  for (const plan of planStatus?.providers || []) {
    for (const key of [plan.providerId, plan.configuredProviderId, plan.providerType]) {
      if (key && !planByRoute.has(key)) planByRoute.set(key, plan);
    }
  }
  const basePlanConfig: ProviderPlanConfig = planConfig || {
    enabled: true,
    routerEnforcement: true,
    warningThresholdPct: 80,
    staleAfterMinutes: 120,
    providers: {},
  };
  const savePlanConfigPatch = (patch: Partial<ProviderPlanConfig>) => {
    if (!planConfig) return Promise.resolve();
    return savePlanConfig({
      ...basePlanConfig,
      ...patch,
      providers: patch.providers || basePlanConfig.providers || {},
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-indigo-400" />
            Model Provider Router
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Route chats across subscriptions and pay-per-token providers with automatic failover,
            selection strategies, provider limits, and cash spend caps.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-center">
          <div className="rounded-lg bg-black/25 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Active</p>
            <p className="text-sm font-semibold text-white">
              {activeRoutes.length}/{status?.routes.length || 0}
            </p>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Today</p>
            <p className="text-sm font-semibold text-emerald-300">{formatMoney(spendToday, 4)}</p>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Prices</p>
            <p className="text-sm font-semibold text-cyan-300">
              {configuredPricingCount}/{status?.routes.length || 0}
            </p>
          </div>
          <div className="rounded-lg bg-black/25 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Plans</p>
            <p className="text-sm font-semibold text-amber-300">
              {planStatusLoaded
                ? `${planSummary?.configured || 0}/${planSummary?.monitored || 0}`
                : "..."}
            </p>
          </div>
        </div>
      </div>

      {!setupComplete && (
        <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/[0.07] p-4">
          <h3 className="text-sm font-semibold text-white">Get started in three steps</h3>
          <p className="mt-0.5 text-xs text-gray-400">
            The router balances chats between providers, so it needs at least two to choose from.
          </p>
          <ol className="mt-3 space-y-2 text-sm">
            <li className="flex items-start gap-2">
              {hasEnoughProviders ? (
                <CheckCircle2 className="mt-0.5 w-4 h-4 flex-shrink-0 text-emerald-400" />
              ) : (
                <Circle className="mt-0.5 w-4 h-4 flex-shrink-0 text-gray-600" />
              )}
              <span className={hasEnoughProviders ? "text-gray-500 line-through" : "text-gray-200"}>
                Connect at least two providers with models on the{" "}
                <Link to="/providers" className="text-indigo-300 underline hover:text-indigo-200">
                  Providers page
                </Link>{" "}
                ({providers.length} of 2 connected)
              </span>
            </li>
            <li className="flex items-start gap-2">
              {hasEnoughRoutes ? (
                <CheckCircle2 className="mt-0.5 w-4 h-4 flex-shrink-0 text-emerald-400" />
              ) : (
                <Circle className="mt-0.5 w-4 h-4 flex-shrink-0 text-gray-600" />
              )}
              <span className={hasEnoughRoutes ? "text-gray-500 line-through" : "text-gray-200"}>
                Add at least two of them to the rotation below ({routedTypes.length} of 2 added)
              </span>
            </li>
            <li className="flex items-start gap-2">
              {config.enabled ? (
                <CheckCircle2 className="mt-0.5 w-4 h-4 flex-shrink-0 text-emerald-400" />
              ) : (
                <Circle className="mt-0.5 w-4 h-4 flex-shrink-0 text-gray-600" />
              )}
              <span className={config.enabled ? "text-gray-500 line-through" : "text-gray-200"}>
                Turn the router on and pick a strategy — Weighted is a good default
              </span>
            </li>
          </ol>
        </div>
      )}

      {saveError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {saveError} — your last change may not have been saved.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr),minmax(320px,0.85fr)] gap-4">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-sm font-medium text-gray-200">Router Enabled</span>
              <p className="text-xs text-gray-500">
                {config.enabled
                  ? "Requests are being routed across your configured providers."
                  : hasEnoughRoutes
                    ? "Turn on to start routing. Off means each agent uses only its own provider."
                    : "Add at least two providers to the rotation below before turning this on."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => saveConfig({ ...config, enabled: !config.enabled })}
              disabled={!config.enabled && !hasEnoughRoutes}
              className="p-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                !config.enabled && !hasEnoughRoutes
                  ? "The router needs at least two providers in the rotation"
                  : undefined
              }
              aria-label={config.enabled ? "Disable router" : "Enable router"}
            >
              {config.enabled ? (
                <ToggleRight className="w-8 h-8 text-emerald-400" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-gray-600" />
              )}
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-300">Selection strategy</label>
            <select
              value={config.strategy}
              onChange={(e) =>
                saveConfig({ ...config, strategy: e.target.value as RouterConfig["strategy"] })
              }
              className={`${SELECT_CONTROL_CLASS} w-full`}
            >
              {STRATEGY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500">{STRATEGY_HELP[config.strategy]}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {STRATEGY_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => saveConfig({ ...config, strategy: option.value })}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    option.value === config.strategy
                      ? "border-indigo-400/50 bg-indigo-500/15"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                  )}
                >
                  <span className="block text-xs font-semibold text-white">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] text-gray-500">{option.costHint}</span>
                </button>
              ))}
            </div>
          </div>

          {config.strategy === "mixture_of_agents" && (
            <>
              <div className="space-y-1">
                <label className="text-sm text-gray-300">Max proposer agents</label>
                <input
                  type="number"
                  min={1}
                  defaultValue={config.moaMaxAgents ?? ""}
                  placeholder="4"
                  onBlur={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    const next = Number.isFinite(n) && n > 0 ? n : undefined;
                    if (next !== config.moaMaxAgents) {
                      void saveConfig({ ...config, moaMaxAgents: next });
                    }
                  }}
                  className={`${SELECT_CONTROL_CLASS} w-full sm:w-40`}
                />
                <p className="text-xs text-gray-500">
                  How many agents propose before one synthesizes the final answer (default 4).
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-gray-300">Aggregator agent</label>
                <select
                  value={config.moaAggregatorAgentId ?? ""}
                  onChange={(e) =>
                    saveConfig({ ...config, moaAggregatorAgentId: e.target.value || undefined })
                  }
                  className={`${SELECT_CONTROL_CLASS} w-full`}
                >
                  <option value="">Auto (first proposer)</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">
                  The agent that synthesizes the proposals into the final answer.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-emerald-500/15 p-2">
              <DollarSign className="w-4 h-4 text-emerald-300" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Cash budget guardrail</h3>
              <p className="text-xs text-gray-500">
                Use monthly budget for flat coding plans, or per-token pricing for metered APIs.
                Both save into the gateway daily cap and provider token prices.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Daily cap</span>
              <input
                type="number"
                min={0}
                step={0.25}
                value={dailyLimit || ""}
                placeholder="No cap"
                onChange={(e) =>
                  setConfig({
                    ...config,
                    globalSpendLimitDaily: normalizedSpendLimit(e.target.value),
                  })
                }
                onBlur={(e) =>
                  saveConfig({
                    ...config,
                    globalSpendLimitDaily: normalizedSpendLimit(e.target.value),
                  })
                }
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-gray-600"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Monthly budget</span>
              <input
                type="number"
                min={0}
                step={1}
                value={monthlyEquivalent ? Number(monthlyEquivalent.toFixed(2)) : ""}
                placeholder="$20 plan"
                onChange={(e) => {
                  const monthly = normalizedSpendLimit(e.target.value);
                  setConfig({
                    ...config,
                    globalSpendLimitDaily: monthly ? monthly / 30 : undefined,
                  });
                }}
                onBlur={(e) => {
                  const monthly = normalizedSpendLimit(e.target.value);
                  saveConfig({
                    ...config,
                    globalSpendLimitDaily: monthly ? monthly / 30 : undefined,
                  });
                }}
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-gray-600"
              />
            </label>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-gray-500">
                Spent today {formatMoney(spendToday, 4)}
                {dailyLimit > 0 ? ` of ${formatMoney(dailyLimit, 2)}` : " (uncapped)"}
              </span>
              <span className="text-gray-500">
                {dailyLimit > 0 ? `${budgetUsedPct.toFixed(1)}%` : "No cap"}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  budgetUsedPct >= 90
                    ? "bg-red-400"
                    : budgetUsedPct >= 70
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                )}
                style={{ width: `${dailyLimit > 0 ? Math.max(2, budgetUsedPct) : 0}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/10 p-3 text-xs text-cyan-100/90">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-cyan-50">Plan-aware routing</p>
                <p className="mt-0.5 text-cyan-100/75">
                  Use provider coding-plan presets where limits are published, then let the router
                  avoid exhausted providers before it spends API money.
                </p>
              </div>
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                {planStatusLoaded ? `${planSummary?.configured || 0} configured` : "Loading"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => savePlanConfigPatch({ enabled: !planMonitoringEnabled })}
                disabled={!planConfigLoaded}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border border-cyan-200/15 bg-black/20 px-3 py-2 text-left",
                  !planConfigLoaded && "cursor-not-allowed opacity-50"
                )}
              >
                <span>
                  <span className="block text-[11px] font-semibold text-cyan-50">
                    Monitor plans
                  </span>
                  <span className="block text-[10px] text-cyan-100/65">
                    Track local usage against plan windows
                  </span>
                </span>
                {planMonitoringEnabled ? (
                  <ToggleRight className="h-6 w-6 flex-shrink-0 text-emerald-300" />
                ) : (
                  <ToggleLeft className="h-6 w-6 flex-shrink-0 text-gray-500" />
                )}
              </button>
              <button
                type="button"
                onClick={() => savePlanConfigPatch({ routerEnforcement: !planEnforcementEnabled })}
                disabled={!planConfigLoaded}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border border-cyan-200/15 bg-black/20 px-3 py-2 text-left",
                  !planConfigLoaded && "cursor-not-allowed opacity-50"
                )}
              >
                <span>
                  <span className="block text-[11px] font-semibold text-cyan-50">
                    Block exhausted plans
                  </span>
                  <span className="block text-[10px] text-cyan-100/65">
                    Skip providers at their hard stop
                  </span>
                </span>
                {planEnforcementEnabled ? (
                  <ToggleRight className="h-6 w-6 flex-shrink-0 text-emerald-300" />
                ) : (
                  <ToggleLeft className="h-6 w-6 flex-shrink-0 text-gray-500" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Routes */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-200 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" />
          Providers in rotation
        </h3>
        {status && status.routes.length > 0 ? (
          status.routes.map((route) => {
            const plan = planByRoute.get(route.providerId);
            const routeType = plan?.providerType || route.providerId;
            return (
              <RouteRow
                key={route.providerId}
                route={route}
                config={config}
                onSave={saveConfig}
                displayName={plan?.providerName || providerName(routeType)}
                models={providerModels(routeType)}
                plan={plan}
                planConfig={planConfig?.providers?.[route.providerId] || null}
                onPlanConfigChange={(next) => {
                  const base = planConfig || {
                    enabled: true,
                    routerEnforcement: true,
                    warningThresholdPct: 80,
                    staleAfterMinutes: 120,
                    providers: {},
                  };
                  const providersById = base.providers || {};
                  void savePlanConfig({
                    ...base,
                    providers: {
                      ...providersById,
                      [route.providerId]: next,
                    },
                  });
                }}
              />
            );
          })
        ) : (
          <p className="text-xs text-gray-500">
            No providers added to the router yet. Pick one below to start routing.
          </p>
        )}
      </div>

      {/* Add new route */}
      <AddRouteForm
        config={config}
        onSave={saveConfig}
        saving={saving}
        options={unroutedProviders}
      />
    </div>
  );
}

function RouteRow({
  route,
  config,
  onSave,
  displayName,
  models,
  plan,
  planConfig,
  onPlanConfigChange,
}: {
  route: RouteStatus;
  config: RouterConfig;
  onSave: (cfg: RouterConfig) => Promise<void>;
  displayName: string;
  models: string[];
  plan?: ProviderPlanSnapshot;
  planConfig: ProviderPlanProviderConfig | null;
  onPlanConfigChange: (next: ProviderPlanProviderConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const routeCfg = (config.routes[route.providerId] ?? {}) as Record<string, number | boolean>;

  const update = (key: string, value: number | boolean) => {
    const routes = { ...config.routes };
    routes[route.providerId] = { ...routeCfg, [key]: value };
    void onSave({ ...config, routes });
  };

  const remove = () => {
    const routes = { ...config.routes };
    delete routes[route.providerId];
    void onSave({ ...config, routes });
  };

  const updatePlan = (
    key: "planName" | "monthlyTokenLimit" | "monthlySpendLimit",
    value: string
  ) => {
    const next: ProviderPlanProviderConfig = {
      ...(planConfig || {}),
      enabled: true,
    };
    if (key === "planName") {
      next.planName = value.trim() || undefined;
    } else {
      const monthly = { ...(next.monthly || {}), enabled: true };
      if (key === "monthlyTokenLimit") monthly.tokenLimit = normalizedPositiveNumber(value);
      if (key === "monthlySpendLimit") monthly.spendLimit = normalizedPositiveNumber(value);
      next.monthly = monthly;
    }
    onPlanConfigChange(next);
  };

  const applyPreset = (preset: ProviderPlanPresetSuggestion) => {
    const nextPlan: ProviderPlanProviderConfig = {
      ...(planConfig || {}),
      enabled: true,
      presetId: preset.id,
      planName: preset.planName,
      sourceMode: preset.sourceMode,
      externalSourceEnabled: preset.externalSourceEnabled,
    };
    if (preset.monthlyTokenLimit || preset.monthlySpendLimit) {
      nextPlan.monthly = {
        ...(nextPlan.monthly || {}),
        enabled: true,
        tokenLimit: preset.monthlyTokenLimit,
        spendLimit: preset.monthlySpendLimit,
      };
    }
    if (preset.weeklyTokenLimit) {
      nextPlan.weekly = {
        ...(nextPlan.weekly || {}),
        enabled: true,
        tokenLimit: preset.weeklyTokenLimit,
      };
    }
    if (preset.fiveHourTokenLimit) {
      nextPlan.fiveHour = {
        ...(nextPlan.fiveHour || {}),
        enabled: true,
        tokenLimit: preset.fiveHourTokenLimit,
      };
    }
    onPlanConfigChange(nextPlan);

    const routeUpdates: Record<string, number> = {};
    if (preset.routeLimit5h) routeUpdates.limit5h = preset.routeLimit5h;
    if (preset.routeLimitWeekly) routeUpdates.limitWeekly = preset.routeLimitWeekly;
    if (Object.keys(routeUpdates).length > 0) {
      const routes = { ...config.routes };
      routes[route.providerId] = { ...routeCfg, ...routeUpdates };
      void onSave({ ...config, routes });
    }
  };

  const suggestions = plan?.presetSuggestions || [];
  const manualPlanEditable = plan?.manualPlanEditable !== false;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-white truncate">{displayName}</span>
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded",
              !route.enabled
                ? "bg-gray-500/20 text-gray-400"
                : route.available
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-red-500/20 text-red-300"
            )}
          >
            {!route.enabled ? "disabled" : route.available ? "available" : "blocked"}
          </span>
          {route.reason && <span className="text-[10px] text-red-400">{route.reason}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => update("enabled", !routeCfg.enabled)}>
            {routeCfg.enabled !== false ? (
              <ToggleRight className="w-6 h-6 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-6 h-6 text-gray-600" />
            )}
          </button>
          <button
            type="button"
            onClick={remove}
            className="text-[11px] text-gray-500 hover:text-red-300"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500 sm:grid-cols-4">
        <div className="rounded-lg bg-white/[0.035] px-2.5 py-2">
          <p className="text-gray-600">Weight</p>
          <p className="font-semibold text-gray-200">{Number(routeCfg.weight ?? 50)}</p>
        </div>
        <div className="rounded-lg bg-white/[0.035] px-2.5 py-2">
          <p className="text-gray-600">Requests</p>
          <p className="font-semibold text-gray-200">
            {route.requestsIn5hWindow} / {route.requestsInWeekWindow}
          </p>
        </div>
        <div className="rounded-lg bg-white/[0.035] px-2.5 py-2">
          <p className="text-gray-600">Spend today</p>
          <p className="font-semibold text-emerald-300">{formatMoney(route.spendToday, 4)}</p>
        </div>
        <div className="rounded-lg bg-white/[0.035] px-2.5 py-2">
          <p className="text-gray-600">Token price</p>
          <p className="font-semibold text-cyan-300">
            {formatTokenPrice(route.priceInputPerM, route.priceOutputPerM)}
          </p>
        </div>
      </div>

      {models.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg bg-white/[0.025] px-2.5 py-2 text-[11px] text-gray-500">
          <Cpu className="w-3 h-3" />
          <span className="truncate">
            {models.slice(0, 5).join(", ")}
            {models.length > 5 ? ` +${models.length - 5} more` : ""}
          </span>
        </div>
      )}

      {plan && <PlanStatusPanel plan={plan} />}

      <div className="flex items-center gap-3 text-[11px] text-gray-500">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-indigo-400 hover:text-indigo-300"
        >
          {open ? "Hide controls" : manualPlanEditable ? "Limits & pricing" : "Routing & pricing"}
        </button>
      </div>

      {open && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <RouteField
              label="Weight"
              value={Number(routeCfg.weight ?? 50)}
              onChange={(v) => update("weight", v)}
            />
            <RouteField
              label="5h Limit"
              value={Number(routeCfg.limit5h ?? 0)}
              onChange={(v) => update("limit5h", v)}
            />
            <RouteField
              label="Weekly Limit"
              value={Number(routeCfg.limitWeekly ?? 0)}
              onChange={(v) => update("limitWeekly", v)}
            />
            <RouteField
              label="$ Daily"
              value={Number(routeCfg.spendLimitDaily ?? 0)}
              onChange={(v) => update("spendLimitDaily", v)}
              step={0.5}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <RouteField
              label="$/M Input"
              value={Number(routeCfg.priceInputPerM ?? 0)}
              onChange={(v) => update("priceInputPerM", v)}
              step={0.5}
            />
            <RouteField
              label="$/M Output"
              value={Number(routeCfg.priceOutputPerM ?? 0)}
              onChange={(v) => update("priceOutputPerM", v)}
              step={0.5}
            />
          </div>
          {manualPlanEditable ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-3">
              <div className="sm:col-span-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-amber-100">Coding plan preset</p>
                    <p className="text-[10px] text-amber-100/60">
                      Pick the subscription you actually use. Presets fill known guardrails; dynamic
                      plans still need provider usage data or manual hard stops.
                    </p>
                  </div>
                  {plan?.appliedPresetId && (
                    <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[10px] text-amber-100">
                      preset applied
                    </span>
                  )}
                </div>
                {suggestions.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                    {suggestions.map((preset) => {
                      const selected =
                        (planConfig?.presetId || plan?.appliedPresetId) === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applyPreset(preset)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left transition-colors",
                            selected
                              ? "border-amber-300/60 bg-amber-300/15"
                              : "border-white/10 bg-black/20 hover:bg-white/[0.05]"
                          )}
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] font-semibold text-white">
                                {preset.label}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-gray-400">
                                {presetLimitSummary(preset)}
                              </span>
                            </span>
                            <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-100/80">
                              {confidenceLabel(preset.confidence)}
                            </span>
                          </span>
                          <span className="mt-1 block line-clamp-2 text-[10px] text-gray-500">
                            {preset.limitDescription}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-gray-400">
                    No published coding-plan preset for this provider yet. Use manual caps below.
                  </p>
                )}
              </div>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] text-amber-200/70">Manual plan name</span>
                <input
                  key={`plan-name-${planConfig?.planName || plan?.planName || ""}`}
                  defaultValue={planConfig?.planName || plan?.planName || ""}
                  placeholder="$20 coding plan"
                  onBlur={(e) => updatePlan("planName", e.target.value)}
                  className="w-full rounded bg-black/25 border border-white/10 px-2 py-1 text-xs text-white placeholder:text-gray-600"
                />
              </label>
              <RoutePlanField
                label="Monthly tokens"
                value={planConfig?.monthly?.tokenLimit}
                placeholder="20000000"
                onChange={(value) => updatePlan("monthlyTokenLimit", value)}
              />
              <RoutePlanField
                label="Monthly spend"
                value={planConfig?.monthly?.spendLimit}
                placeholder="20"
                step={0.5}
                onChange={(value) => updatePlan("monthlySpendLimit", value)}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.05] p-3 text-[11px] text-cyan-100/80">
              <p className="font-semibold text-cyan-100">Plan tracked automatically</p>
              <p className="mt-1 text-cyan-100/65">
                Manual plan caps are hidden because this provider reports plan usage automatically.
              </p>
            </div>
          )}
          <p className="text-[10px] text-gray-600">
            Route limits of 0 mean unlimited. Plan limits feed usage monitoring and can block an
            exhausted provider before the router chooses it.
          </p>
        </div>
      )}
    </div>
  );
}

function PlanStatusPanel({ plan }: { plan: ProviderPlanSnapshot }) {
  const automaticUsageSummary = planAutomaticUsageSummary(plan);
  const statusClass =
    plan.status === "exhausted"
      ? "border-red-400/25 bg-red-500/10 text-red-200"
      : plan.status === "warning"
        ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
        : plan.status === "ok"
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
          : "border-white/10 bg-white/[0.025] text-gray-300";

  return (
    <div className={cn("rounded-lg border p-3", statusClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold">
            {plan.planName || "Provider plan"} · {plan.status}
          </p>
          <p className="mt-0.5 text-[11px] opacity-75">
            {automaticUsageSummary ||
              plan.reason ||
              `${formatCompactNumber(plan.localTokens30d)} local tokens · ${formatMoney(
                plan.localSpend30d,
                4
              )} local spend in 30d`}
          </p>
        </div>
        {plan.monitored && (
          <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
            monitored
          </span>
        )}
      </div>
      {!plan.managedAutomatically && plan.windows.length > 0 && (
        <div className="mt-3 grid gap-2">
          {plan.windows.map((window) => {
            const percentValue = Math.min(100, Math.max(0, window.usedPercent ?? 0));
            return (
              <div key={window.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px] opacity-80">
                  <span>
                    {window.title} · {window.resetDescription}
                  </span>
                  <span>
                    {window.usedPercent === undefined
                      ? `${formatCompactNumber(window.usedTokens)} tokens`
                      : `${window.usedPercent.toFixed(1)}%`}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      percentValue >= 95
                        ? "bg-red-300"
                        : percentValue >= 80
                          ? "bg-amber-300"
                          : "bg-emerald-300"
                    )}
                    style={{ width: `${Math.max(2, percentValue)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function planAutomaticUsageSummary(plan: ProviderPlanSnapshot): string | null {
  if (!plan.managedAutomatically) return null;
  const windows = plan.windows.filter(
    (window) =>
      (window.kind === "rolling_5h" || window.kind === "rolling_week") &&
      window.usageKnown &&
      (window.unlimited || typeof window.usedPercent === "number")
  );
  if (windows.length === 0) return null;
  return windows
    .slice(0, 2)
    .map(
      (window) =>
        `${window.kind === "rolling_5h" ? "5h" : "Weekly"} ${
          window.unlimited
            ? "∞"
            : typeof window.usedPercent === "number"
              ? `${Math.ceil(window.usedPercent)}%`
              : "--"
        }${formatRouterPlanReset(window.resetsAt)}`
    )
    .join(" · ");
}

function formatRouterPlanReset(resetsAt?: string): string {
  if (!resetsAt) return "";
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return "";
  const diffMs = resetMs - Date.now();
  if (diffMs <= 0) return " (reset ready)";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return ` (resets in ${Math.max(1, Math.ceil(diffMs / minute))}m)`;
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    const minutes = Math.ceil((diffMs % hour) / minute);
    return minutes > 0 ? ` (resets in ${hours}h ${minutes}m)` : ` (resets in ${hours}h)`;
  }
  return ` (resets in ${Math.ceil(diffMs / day)}d)`;
}

function RouteField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-gray-500">{label}</label>
      <input
        key={`${label}-${value ?? ""}`}
        type="number"
        min={0}
        step={step}
        defaultValue={value}
        onBlur={(e) => {
          const next = Number(e.target.value);
          if (next !== value) onChange(next);
        }}
        className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white"
      />
    </div>
  );
}

function RoutePlanField({
  label,
  value,
  placeholder,
  onChange,
  step = 1,
}: {
  label: string;
  value?: number;
  placeholder: string;
  onChange: (value: string) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-amber-200/70">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        defaultValue={value || ""}
        placeholder={placeholder}
        onBlur={(e) => onChange(e.target.value)}
        className="w-full rounded bg-black/25 border border-white/10 px-2 py-1 text-xs text-white placeholder:text-gray-600"
      />
    </label>
  );
}

function AddRouteForm({
  config,
  onSave,
  saving,
  options,
}: {
  config: RouterConfig;
  onSave: (cfg: RouterConfig) => Promise<void>;
  saving: boolean;
  options: ProviderMeta[];
}) {
  const [selected, setSelected] = useState("");

  const add = (type: string) => {
    if (!type) return;
    const routes = { ...config.routes };
    routes[type] = { weight: 50, enabled: true };
    void onSave({ ...config, routes });
    setSelected("");
  };

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <label className="text-xs text-gray-500 mb-1.5 block">Add a provider to the router</label>
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={`${SELECT_CONTROL_CLASS} min-w-0 flex-1`}
        >
          <option value="">Select a provider…</option>
          {options.map((p) => (
            <option key={p.type} value={p.type}>
              {p.name}
              {p.models.length
                ? ` (${p.models.length} model${p.models.length === 1 ? "" : "s"})`
                : ""}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={() => add(selected)} disabled={saving || !selected}>
          <Plus className="w-3.5 h-3.5" />
          Add
        </Button>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        Enabling a provider here adds it to the rotation with a default weight of 50. Adjust weights
        and limits per provider after adding.
      </p>
    </div>
  );
}
