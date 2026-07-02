import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Settings2, DollarSign, Activity, ToggleLeft, ToggleRight, Plus, Cpu } from 'lucide-react';
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
  strategy: 'weighted' | 'round_robin' | 'lowest_cost' | 'priority' | 'mixture_of_agents';
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

const STRATEGY_HELP: Record<RouterConfig['strategy'], string> = {
  weighted: 'Spread requests across providers proportionally to each weight.',
  round_robin: 'Rotate through providers evenly, one after another.',
  lowest_cost: 'Always pick the cheapest available provider by token price.',
  priority: 'Use the highest-priority provider first; fall back only when it is unavailable.',
  mixture_of_agents: 'Fan each turn out to several proposer agents, then synthesize one answer with an aggregator agent.',
};

export function RouterSettings() {
  const [status, setStatus] = useState<RouterStatus | null>(null);
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/router/status');
      setStatus(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/router/config');
      setConfig(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await apiFetch('/api/providers');
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

  useEffect(() => {
    void fetchConfig();
    void fetchStatus();
    void fetchProviders();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchConfig, fetchProviders]);

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

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-indigo-400" />
          Model Provider Router
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Send traffic across several providers with automatic failover, weighting, rate limits,
          and spend caps. Add the providers you want to use, choose how to pick between them, and
          turn it on.
        </p>
      </div>

      {providers.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          No providers are configured yet.{' '}
          <Link to="/providers" className="underline hover:text-amber-100">
            Add a provider
          </Link>{' '}
          first, then come back to route between them.
        </div>
      )}

      {/* Enable / Strategy */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-200">Router Enabled</span>
            <p className="text-xs text-gray-500">
              {config.enabled
                ? 'Requests are being routed across your configured providers.'
                : 'Turn on to start routing. Off means each agent uses only its own provider.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveConfig({ ...config, enabled: !config.enabled })}
            className="p-1"
            aria-label={config.enabled ? 'Disable router' : 'Enable router'}
          >
            {config.enabled ? (
              <ToggleRight className="w-8 h-8 text-emerald-400" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-gray-600" />
            )}
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-300">Selection strategy</label>
          <select
            value={config.strategy}
            onChange={(e) => saveConfig({ ...config, strategy: e.target.value as RouterConfig['strategy'] })}
            className="w-full sm:w-auto rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white"
          >
            <option value="weighted">Weighted (default)</option>
            <option value="round_robin">Round Robin</option>
            <option value="lowest_cost">Lowest Cost</option>
            <option value="priority">Priority</option>
            <option value="mixture_of_agents">Mixture of Agents</option>
          </select>
          <p className="text-xs text-gray-500">{STRATEGY_HELP[config.strategy]}</p>
        </div>

        {config.strategy === 'mixture_of_agents' && (
          <div className="space-y-1">
            <label className="text-sm text-gray-300">Max proposer agents</label>
            <input
              type="number"
              min={1}
              value={config.moaMaxAgents ?? ''}
              placeholder="4"
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                saveConfig({ ...config, moaMaxAgents: Number.isFinite(n) && n > 0 ? n : undefined });
              }}
              className="w-full sm:w-auto rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white"
            />
            <p className="text-xs text-gray-500">
              How many agents propose before one synthesizes the final answer (default 4).
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <DollarSign className="w-4 h-4 text-gray-500" />
          <label className="text-sm text-gray-300">Global daily spend limit ($)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={config.globalSpendLimitDaily ?? 0}
            onChange={(e) =>
              setConfig({ ...config, globalSpendLimitDaily: Number(e.target.value) || undefined })
            }
            onBlur={() => saveConfig(config)}
            className="w-24 rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-sm text-white"
          />
          <span className="text-xs text-gray-500">0 = no cap</span>
          {status && (
            <span className="text-xs text-gray-500 ml-2">
              Spent today: ${status.globalSpendToday.toFixed(4)}
            </span>
          )}
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
    void onSave({ ...config, routes, enabled: true });
  };

  const remove = () => {
    const routes = { ...config.routes };
    delete routes[route.providerId];
    void onSave({ ...config, routes });
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-white truncate">{displayName}</span>
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded',
              !route.enabled
                ? 'bg-gray-500/20 text-gray-400'
                : route.available
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-red-500/20 text-red-300'
            )}
          >
            {!route.enabled ? 'disabled' : route.available ? 'available' : 'blocked'}
          </span>
          {route.reason && <span className="text-[10px] text-red-400">{route.reason}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => update('enabled', !routeCfg.enabled)}>
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

      {models.length > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <Cpu className="w-3 h-3" />
          <span className="truncate">
            {models.slice(0, 3).join(', ')}
            {models.length > 3 ? ` +${models.length - 3} more` : ''}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-gray-500">
        <span>Weight {Number(routeCfg.weight ?? 50)}</span>
        <span>5h: {route.requestsIn5hWindow}</span>
        <span>Week: {route.requestsInWeekWindow}</span>
        <span>Today: ${route.spendToday.toFixed(4)}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-indigo-400 hover:text-indigo-300"
        >
          {open ? 'Hide limits' : 'Limits & pricing'}
        </button>
      </div>

      {open && (
        <div className="pt-1 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <RouteField label="Weight" value={Number(routeCfg.weight ?? 50)} onChange={(v) => update('weight', v)} />
            <RouteField label="5h Limit" value={Number(routeCfg.limit5h ?? 0)} onChange={(v) => update('limit5h', v)} />
            <RouteField label="Weekly Limit" value={Number(routeCfg.limitWeekly ?? 0)} onChange={(v) => update('limitWeekly', v)} />
            <RouteField label="$ Daily" value={Number(routeCfg.spendLimitDaily ?? 0)} onChange={(v) => update('spendLimitDaily', v)} step={0.5} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <RouteField label="$/M Input" value={Number(routeCfg.priceInputPerM ?? 0)} onChange={(v) => update('priceInputPerM', v)} step={0.5} />
            <RouteField label="$/M Output" value={Number(routeCfg.priceOutputPerM ?? 0)} onChange={(v) => update('priceOutputPerM', v)} step={0.5} />
          </div>
          <p className="text-[10px] text-gray-600">Limits of 0 mean unlimited. Pricing is used by the Lowest Cost strategy.</p>
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
  const [selected, setSelected] = useState('');

  const add = (type: string) => {
    if (!type) return;
    const routes = { ...config.routes };
    routes[type] = { weight: 50, enabled: true };
    void onSave({ ...config, routes, enabled: true });
    setSelected('');
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
          className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white"
        >
          <option value="">Select a provider…</option>
          {options.map((p) => (
            <option key={p.type} value={p.type}>
              {p.name}
              {p.models.length ? ` (${p.models.length} model${p.models.length === 1 ? '' : 's'})` : ''}
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
