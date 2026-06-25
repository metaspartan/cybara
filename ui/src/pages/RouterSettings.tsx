import { useState, useEffect, useCallback } from 'react';
import { Loader2, Settings2, DollarSign, Activity, ToggleLeft, ToggleRight, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/auth';

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
  strategy: 'weighted' | 'round_robin' | 'lowest_cost';
  globalSpendLimitDaily?: number;
  fallbackToAny: boolean;
  routes: Record<string, Record<string, unknown>>;
}

export function RouterSettings() {
  const [status, setStatus] = useState<RouterStatus | null>(null);
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/router/status');
      const data = await res.json();
      setStatus(data);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/router/config');
      const data = await res.json();
      setConfig(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
    void fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchConfig]);

  const saveConfig = async (cfg: RouterConfig) => {
    setSaving(true);
    try {
      await apiFetch('/api/router/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      setConfig(cfg);
      await fetchStatus();
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-indigo-400" />
          Model Provider Router
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Route requests across multiple providers with weighted selection, rate limits, and spend budgets.
          A feature unique to Cybara — neither OpenClaw nor Hermes has this.
        </p>
      </div>

      {/* Enable / Strategy */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-200">Router Enabled</span>
            <p className="text-xs text-gray-500">When enabled, requests are routed based on weights and limits.</p>
          </div>
          <button
            type="button"
            onClick={() => saveConfig({ ...config, enabled: !config.enabled })}
            className="p-1"
          >
            {config.enabled ? (
              <ToggleRight className="w-8 h-8 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-gray-600" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-4">
          <label className="text-sm text-gray-300">Strategy</label>
          <select
            value={config.strategy}
            onChange={(e) => saveConfig({ ...config, strategy: e.target.value as RouterConfig['strategy'] })}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white"
          >
            <option value="weighted">Weighted (default)</option>
            <option value="round_robin">Round Robin</option>
            <option value="lowest_cost">Lowest Cost</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-gray-500" />
          <label className="text-sm text-gray-300">Global Daily Spend Limit ($)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={config.globalSpendLimitDaily ?? 0}
            onChange={(e) =>
              setConfig({ ...config, globalSpendLimitDaily: Number(e.target.value) || undefined })
            }
            className="w-24 rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-sm text-white"
          />
          {status && (
            <span className="text-xs text-gray-500 ml-2">
              Today: ${status.globalSpendToday.toFixed(4)}
            </span>
          )}
        </div>
      </div>

      {/* Routes */}
      {status && status.routes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-200 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-400" />
            Configured Routes
          </h3>
          {status.routes.map((route) => (
            <RouteRow key={route.providerId} route={route} config={config} onSave={saveConfig} saving={saving} />
          ))}
        </div>
      )}

      {/* Add new route */}
      <AddRouteForm config={config} onSave={saveConfig} saving={saving} />
    </div>
  );
}

function RouteRow({
  route,
  config,
  onSave,
  saving,
}: {
  route: RouteStatus;
  config: RouterConfig;
  onSave: (cfg: RouterConfig) => Promise<void>;
  saving: boolean;
}) {
  const routeCfg = (config.routes[route.providerId] ?? {}) as Record<string, number | boolean>;

  const update = (key: string, value: number | boolean) => {
    const routes = { ...config.routes };
    routes[route.providerId] = { ...routeCfg, [key]: value };
    void onSave({ ...config, routes, enabled: true });
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{route.providerId}</span>
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
        <button type="button" onClick={() => update("enabled", !routeCfg.enabled)}>
          {routeCfg.enabled !== false ? (
            <ToggleRight className="w-6 h-6 text-emerald-400" />
          ) : (
            <ToggleLeft className="w-6 h-6 text-gray-600" />
          )}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <RouteField label="Weight" value={Number(routeCfg.weight ?? 50)} onChange={(v) => update("weight", v)} />
        <RouteField label="5h Limit" value={Number(routeCfg.limit5h ?? 0)} onChange={(v) => update("limit5h", v)} />
        <RouteField label="Weekly Limit" value={Number(routeCfg.limitWeekly ?? 0)} onChange={(v) => update("limitWeekly", v)} />
        <RouteField label="$ Daily" value={Number(routeCfg.spendLimitDaily ?? 0)} onChange={(v) => update("spendLimitDaily", v)} step={0.5} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RouteField label="$/M Input" value={Number(routeCfg.priceInputPerM ?? 0)} onChange={(v) => update("priceInputPerM", v)} step={0.5} />
        <RouteField label="$/M Output" value={Number(routeCfg.priceOutputPerM ?? 0)} onChange={(v) => update("priceOutputPerM", v)} step={0.5} />
      </div>
      <div className="flex items-center gap-4 text-[11px] text-gray-500">
        <span>5h: {route.requestsIn5hWindow} reqs</span>
        <span>Week: {route.requestsInWeekWindow} reqs</span>
        <span>Today: ${route.spendToday.toFixed(4)}</span>
        <span>Week: ${route.spendThisWeek.toFixed(4)}</span>
      </div>
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
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white"
      />
    </div>
  );
}

function AddRouteForm({
  config,
  onSave,
  saving,
}: {
  config: RouterConfig;
  onSave: (cfg: RouterConfig) => Promise<void>;
  saving: boolean;
}) {
  const [providerId, setProviderId] = useState("");

  const add = () => {
    if (!providerId.trim()) return;
    const routes = { ...config.routes };
    routes[providerId.trim()] = { weight: 50, enabled: true };
    void onSave({ ...config, routes, enabled: true });
    setProviderId("");
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Provider ID (e.g. openai, anthropic)"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white"
        />
        <Button variant="primary" onClick={add} disabled={saving || !providerId.trim()}>
          <Save className="w-3.5 h-3.5" />
          Add Route
        </Button>
      </div>
    </div>
  );
}
