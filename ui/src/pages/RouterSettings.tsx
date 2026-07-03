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
  type: string;
  name: string;
  models: string[];
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

function normalizedSpendLimit(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function RouterSettings() {
  const [status, setStatus] = useState<RouterStatus | null>(null);
  const [config, setConfig] = useState<RouterConfig | null>(null);
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

  const fetchProviders = useCallback(async () => {
    try {
      const res = await apiFetch("/api/providers");
      const data = await res.json();
      const metas: ProviderMeta[] = [];
      const seen = new Set<string>();
      for (const p of Array.isArray(data) ? data : []) {
        const type: string = p.provider || p.type || p.id;
        if (!type || seen.has(type)) continue;
        seen.add(type);
        metas.push({
          type,
          name: p.name || type,
          models: Array.isArray(p.models) ? p.models.map(String) : [],
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
    void fetchProviders();
    void fetchAgents();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchConfig, fetchProviders, fetchAgents]);

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
  const activeRoutes = status?.routes.filter((route) => route.enabled && route.available) || [];
  const dailyLimit = config.globalSpendLimitDaily ?? 0;
  const monthlyEquivalent = dailyLimit > 0 ? dailyLimit * 30 : 0;
  const spendToday = status?.globalSpendToday ?? 0;
  const budgetUsedPct = dailyLimit > 0 ? Math.min(100, (spendToday / dailyLimit) * 100) : 0;
  const pricedRoutes = status?.routes.filter(
    (route) => Number(route.priceInputPerM || 0) > 0 || Number(route.priceOutputPerM || 0) > 0
  );
  const configuredPricingCount = pricedRoutes?.length || 0;

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
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-center">
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
        </div>
      </div>

      {providers.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          No providers are configured yet.{" "}
          <Link to="/providers" className="underline hover:text-amber-100">
            Add a provider
          </Link>{" "}
          first, then come back to route between them.
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
                  : "Turn on to start routing. Off means each agent uses only its own provider."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => saveConfig({ ...config, enabled: !config.enabled })}
              className="p-1"
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
            For a $20/month coding plan, enter 20 as the monthly budget. For metered providers, set
            $/M input and output tokens per provider below, then use Lowest Cost.
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
          status.routes.map((route) => (
            <RouteRow
              key={route.providerId}
              route={route}
              config={config}
              onSave={saveConfig}
              displayName={providerName(route.providerId)}
              models={providerModels(route.providerId)}
            />
          ))
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
}: {
  route: RouteStatus;
  config: RouterConfig;
  onSave: (cfg: RouterConfig) => Promise<void>;
  displayName: string;
  models: string[];
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

      <div className="flex items-center gap-3 text-[11px] text-gray-500">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-indigo-400 hover:text-indigo-300"
        >
          {open ? "Hide limits" : "Limits & pricing"}
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
          <p className="text-[10px] text-gray-600">
            Limits of 0 mean unlimited. Pricing is used by the Lowest Cost strategy.
          </p>
        </div>
      )}
    </div>
  );
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
