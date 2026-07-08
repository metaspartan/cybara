import { useMemo, useState, useEffect, useRef } from "react";
import {
  Cloud,
  Plus,
  Trash2,
  Edit2,
  Search,
  RefreshCw,
  Key,
  Star,
  TestTube,
  Shield,
  Link2,
  Info,
  ExternalLink,
} from "lucide-react";
import { openExternal } from "@/utils/openExternal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Input";
import { PageLayout } from "@/components/layout";
import {
  useProviders,
  useAvailableProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useDiscoverOllama,
} from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import { providerPlansApi } from "@/lib/api";
import { apiFetch } from "@/lib/auth";
import {
  providerPlanWindowDisplay,
  type ProviderPlanWindowDisplay,
} from "@/lib/providerPlanDisplay";
import type {
  Provider,
  AvailableProvider,
  ProviderPlanMonitoringConfig,
  ProviderPlanPresetSuggestion,
  ProviderPlanProviderConfig,
  ProviderPlanSnapshot,
  ProviderPlanStatusResponse,
} from "@/types";

function parsePlanLimitInput(value: FormDataEntryValue | null): number | undefined {
  const parsed = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function Providers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<Provider | null>(null);
  const [providerPlanStatus, setProviderPlanStatus] = useState<ProviderPlanStatusResponse | null>(
    null
  );
  const [providerPlanConfig, setProviderPlanConfig] = useState<ProviderPlanMonitoringConfig | null>(
    null
  );
  const [editingRoutePricing, setEditingRoutePricing] = useState<{
    priceInputPerM?: number;
    priceOutputPerM?: number;
  } | null>(null);

  const { data: providers, isLoading } = useProviders();
  const { data: availableProviders } = useAvailableProviders();
  const { addToast } = useUIStore();

  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();
  const discoverOllama = useDiscoverOllama();

  const filteredProviders = providers?.filter(
    (provider) =>
      provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      provider.provider.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const providerPlanByKey = useMemo(() => {
    const indexed = new Map<string, ProviderPlanSnapshot>();
    for (const plan of providerPlanStatus?.providers || []) {
      for (const key of [plan.providerId, plan.configuredProviderId, plan.providerType]) {
        if (key && !indexed.has(key)) indexed.set(key, plan);
      }
    }
    return indexed;
  }, [providerPlanStatus?.providers]);

  useEffect(() => {
    let mounted = true;
    providerPlansApi
      .status()
      .then((response) => {
        if (mounted && response.success) setProviderPlanStatus(response.data ?? null);
      })
      .catch(() => {
        if (mounted) setProviderPlanStatus(null);
      });
    providerPlansApi
      .config()
      .then((response) => {
        if (mounted && response.success) setProviderPlanConfig(response.data ?? null);
      })
      .catch(() => {
        if (mounted) setProviderPlanConfig(null);
      });
    return () => {
      mounted = false;
    };
  }, [providers?.length]);

  useEffect(() => {
    if (!editingProvider) {
      setEditingRoutePricing(null);
      return;
    }
    let mounted = true;
    apiFetch("/api/router/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((config: { routes?: Record<string, Record<string, unknown>> } | null) => {
        if (!mounted) return;
        const route = config?.routes?.[editingProvider.id] || {};
        setEditingRoutePricing({
          priceInputPerM:
            typeof route.priceInputPerM === "number" ? route.priceInputPerM : undefined,
          priceOutputPerM:
            typeof route.priceOutputPerM === "number" ? route.priceOutputPerM : undefined,
        });
      })
      .catch(() => {
        if (mounted) setEditingRoutePricing({});
      });
    return () => {
      mounted = false;
    };
  }, [editingProvider]);

  const planConfigForProvider = (provider: Provider): ProviderPlanProviderConfig | undefined =>
    providerPlanConfig?.providers[provider.id] ?? providerPlanConfig?.providers[provider.provider];

  const planForProvider = (provider: Provider): ProviderPlanSnapshot | undefined =>
    providerPlanByKey.get(provider.id) ?? providerPlanByKey.get(provider.provider);

  const planPresetsForProvider = (provider: Provider): ProviderPlanPresetSuggestion[] =>
    providerPlanByKey.get(provider.id)?.presetSuggestions ??
    providerPlanByKey.get(provider.provider)?.presetSuggestions ??
    [];

  const savePlanLimits = async (provider: Provider, formData: FormData) => {
    await savePlanWindows(provider, formData);
    await saveRoutePricing(provider, formData);
    const status = await providerPlansApi.status();
    if (status.success) setProviderPlanStatus(status.data ?? null);
  };

  const savePlanWindows = async (provider: Provider, formData: FormData) => {
    if (!providerPlanConfig) return;
    const snapshot = planForProvider(provider);
    if (snapshot?.manualPlanEditable === false) return;
    const planName = String(formData.get("plan_name") ?? "").trim();
    const presetId = String(formData.get("plan_preset_id") ?? "").trim();
    const fiveHourTokens = parsePlanLimitInput(formData.get("plan_five_hour_tokens"));
    const weeklyTokens = parsePlanLimitInput(formData.get("plan_weekly_tokens"));
    const monthlyTokens = parsePlanLimitInput(formData.get("plan_monthly_tokens"));
    const monthlySpend = parsePlanLimitInput(formData.get("plan_monthly_spend"));
    const existing = planConfigForProvider(provider);
    const hasInput =
      Boolean(planName) ||
      Boolean(presetId) ||
      [fiveHourTokens, weeklyTokens, monthlyTokens, monthlySpend].some(
        (value) => value !== undefined
      );
    if (!hasInput && !existing) return;

    const key = providerPlanConfig.providers[provider.id]
      ? provider.id
      : providerPlanConfig.providers[provider.provider]
        ? provider.provider
        : provider.id;
    const nextProviders = { ...providerPlanConfig.providers };
    if (!hasInput) {
      delete nextProviders[key];
    } else {
      const preset = planPresetsForProvider(provider).find((entry) => entry.id === presetId);
      const window = (tokenLimit?: number, spendLimit?: number) =>
        tokenLimit !== undefined || spendLimit !== undefined
          ? { enabled: true, tokenLimit, spendLimit }
          : undefined;
      nextProviders[key] = {
        ...(existing || {}),
        enabled: true,
        presetId: preset?.id,
        planName: planName || preset?.planName || undefined,
        sourceMode: preset?.sourceMode ?? existing?.sourceMode,
        externalSourceEnabled: preset?.externalSourceEnabled ?? existing?.externalSourceEnabled,
        fiveHour: window(fiveHourTokens) ?? undefined,
        weekly: window(weeklyTokens) ?? undefined,
        monthly: window(monthlyTokens, monthlySpend) ?? undefined,
      };
    }
    const payload = { ...providerPlanConfig, enabled: true, providers: nextProviders };
    const response = await providerPlansApi.updateConfig(payload);
    if (!response.success) {
      throw new Error(response.error || "Failed to save plan limits");
    }
    setProviderPlanConfig("data" in response && response.data ? response.data : payload);
  };

  // Custom pay-as-you-go pricing per 1M tokens rides on the router route config
  // (route.priceInputPerM/priceOutputPerM); the catalog price is used when unset.
  const saveRoutePricing = async (provider: Provider, formData: FormData) => {
    const rawInput = String(formData.get("plan_price_input") ?? "").trim();
    const rawOutput = String(formData.get("plan_price_output") ?? "").trim();
    const priceInput = parsePlanLimitInput(formData.get("plan_price_input"));
    const priceOutput = parsePlanLimitInput(formData.get("plan_price_output"));
    const wantsPricing = priceInput !== undefined || priceOutput !== undefined;
    const wantsClear = rawInput === "" && rawOutput === "";

    const res = await apiFetch("/api/router/config");
    if (!res.ok) {
      if (wantsPricing) throw new Error("Failed to load router config for pricing");
      return;
    }
    const config = (await res.json()) as {
      routes?: Record<string, Record<string, unknown>>;
    } & Record<string, unknown>;
    const routes = { ...(config.routes || {}) };
    const route = { ...(routes[provider.id] || {}) };
    const hadPricing = route.priceInputPerM !== undefined || route.priceOutputPerM !== undefined;
    if (!wantsPricing && !(wantsClear && hadPricing)) return;

    if (wantsPricing) {
      route.priceInputPerM = priceInput ?? 0;
      route.priceOutputPerM = priceOutput ?? 0;
    } else {
      delete route.priceInputPerM;
      delete route.priceOutputPerM;
    }
    routes[provider.id] = route;
    const putRes = await apiFetch("/api/router/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, routes }),
    });
    if (!putRes.ok) throw new Error("Failed to save custom pricing");
  };

  const handleCreate = async (formData: FormData) => {
    try {
      await createProvider.mutateAsync({
        provider: formData.get("provider") as string,
        name: formData.get("name") as string,
        api_key: (formData.get("api_key") as string) || undefined,
        access_token: (formData.get("access_token") as string) || undefined,
        is_default: formData.get("is_default") === "on",
      });
      addToast("success", "Provider added successfully");
      setIsCreateModalOpen(false);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to add provider");
    }
  };

  const handleUpdate = async (formData: FormData) => {
    if (!editingProvider) return;
    try {
      await updateProvider.mutateAsync({
        id: editingProvider.id,
        data: {
          name: formData.get("name") as string,
          api_key: (formData.get("api_key") as string) || undefined,
          access_token: (formData.get("access_token") as string) || undefined,
          is_default: formData.get("is_default") === "on",
        },
      });
      await savePlanLimits(editingProvider, formData);
      addToast("success", "Provider updated successfully");
      setEditingProvider(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update provider");
    }
  };

  const handleDelete = async () => {
    if (!deletingProvider) return;
    try {
      await deleteProvider.mutateAsync(deletingProvider.id);
      addToast("success", "Provider deleted successfully");
      setDeletingProvider(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete provider");
    }
  };

  const handleDiscoverOllama = async () => {
    try {
      const result = await discoverOllama.mutateAsync();
      addToast("success", `Discovered ${result.models?.length || 0} Ollama models`);
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to discover Ollama models"
      );
    }
  };

  const handleTestConnection = async (provider: Provider) => {
    addToast("info", `Testing connection to ${provider.name}...`);
    try {
      const res = await apiFetch(`/api/providers/${provider.id}/test`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        addToast("success", `Connection to ${provider.name} successful`);
      } else {
        addToast("error", data.message || data.error || `Connection to ${provider.name} failed`);
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : `Failed to test ${provider.name}`);
    }
  };

  return (
    <PageLayout
      title="Providers"
      subtitle="Manage AI model providers"
      actions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className="w-4 h-4" />}
            onClick={handleDiscoverOllama}
            isLoading={discoverOllama.isPending}
          >
            Discover Ollama
          </Button>
          <Button
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setIsCreateModalOpen(true)}
          >
            Add Provider
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <Input
              placeholder="Search providers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="h-24 animate-pulse">
                <CardContent>
                  <div className="h-4 bg-white/10 rounded w-1/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredProviders?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Cloud className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No providers found</h3>
              <p className="text-gray-400 mb-4">Add your first AI provider to get started</p>
              <Button onClick={() => setIsCreateModalOpen(true)}>Add Provider</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredProviders?.map((provider) => (
              <Card key={provider.id} hover>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
                        <Cloud className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-white truncate">{provider.name}</h3>
                          {isProviderDefault(provider) && (
                            <Badge variant="success" size="sm">
                              <Star className="w-3 h-3 mr-1" />
                              Default
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-400 capitalize">{provider.provider}</p>
                        <ProviderPlanSummary plan={planForProvider(provider)} />
                      </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<TestTube className="w-4 h-4" />}
                        onClick={() => handleTestConnection(provider)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Test</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Edit2 className="w-4 h-4" />}
                        onClick={() => setEditingProvider(provider)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="w-4 h-4" />}
                        onClick={() => setDeletingProvider(provider)}
                        className="text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Delete</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Available Provider Types</CardTitle>
            <CardDescription>Supported AI providers you can connect to</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {availableProviders?.map((provider) => (
                <div key={provider.id} className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <h4 className="font-medium text-white mb-1">{provider.name}</h4>
                  <p className="text-sm text-gray-400">{provider.description}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {provider.models.length > 0
                      ? `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} available`
                      : "No bundled models listed"}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <ProviderModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={handleCreate}
          title="Add Provider"
          availableProviders={availableProviders || []}
          isLoading={createProvider.isPending}
        />

        <ProviderModal
          isOpen={!!editingProvider}
          onClose={() => setEditingProvider(null)}
          onSubmit={handleUpdate}
          title="Edit Provider"
          provider={editingProvider}
          availableProviders={availableProviders || []}
          isLoading={updateProvider.isPending}
          isEdit
          planConfig={editingProvider ? planConfigForProvider(editingProvider) : undefined}
          planSnapshot={editingProvider ? planForProvider(editingProvider) : undefined}
          planConfigReady={providerPlanConfig !== null}
          planPresets={editingProvider ? planPresetsForProvider(editingProvider) : []}
          routePricing={editingRoutePricing ?? undefined}
        />

        <ConfirmDialog
          isOpen={!!deletingProvider}
          onClose={() => setDeletingProvider(null)}
          onConfirm={handleDelete}
          title="Delete Provider"
          description={`Are you sure you want to delete "${deletingProvider?.name}"? Agents using this provider may stop working.`}
          confirmText="Delete"
          isLoading={deleteProvider.isPending}
          variant="danger"
        />
      </div>
    </PageLayout>
  );
}

function ProviderPlanSummary({ plan }: { plan?: ProviderPlanSnapshot }) {
  if (!plan) return null;
  const fiveHour = providerPlanWindowDisplay(plan, "rolling_5h");
  const weekly = providerPlanWindowDisplay(plan, "rolling_week");
  if (!plan.managedAutomatically) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <ProviderPlanUsagePill label="5h" usage={fiveHour} />
      <ProviderPlanUsagePill label="Weekly" usage={weekly} />
    </div>
  );
}

function ProviderPlanUsagePill({
  label,
  usage,
}: {
  label: string;
  usage: ProviderPlanWindowDisplay;
}) {
  const percent = usage.percent;
  const isKnown = percent !== null || usage.unlimited;
  const tone = !isKnown
    ? "border-white/10 bg-white/[0.03] text-gray-500"
    : usage.unlimited
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : percent >= 95
        ? "border-red-400/25 bg-red-400/10 text-red-200"
        : percent >= 80
          ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
          : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200";
  const fillClass = usage.unlimited
    ? "bg-emerald-300/80"
    : percent !== null && percent >= 95
      ? "bg-red-300"
      : percent !== null && percent >= 80
        ? "bg-amber-300"
        : "bg-cyan-300";
  const width = usage.unlimited ? 100 : (percent ?? 0);
  return (
    <span
      className={`inline-flex min-w-[92px] flex-col gap-1 rounded-full border px-2.5 py-1.5 text-xs ${tone}`}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-gray-400">{label}</span>
        <span className="font-semibold tabular-nums">{usage.value}</span>
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-white/10">
        <span
          className={`block h-full rounded-full ${fillClass}`}
          style={{ width: `${Math.max(usage.unlimited ? 100 : 0, width)}%` }}
        />
      </span>
      {usage.resetLabel && (
        <span className="truncate text-[10px] leading-none text-gray-400">{usage.resetLabel}</span>
      )}
    </span>
  );
}

function isProviderDefault(provider?: Pick<Provider, "isDefault" | "is_default"> | null) {
  return (
    provider?.isDefault === true ||
    provider?.isDefault === 1 ||
    provider?.is_default === true ||
    provider?.is_default === 1
  );
}

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  title: string;
  provider?: Provider | null;
  availableProviders: AvailableProvider[];
  isLoading: boolean;
  isEdit?: boolean;
  planConfig?: ProviderPlanProviderConfig;
  planSnapshot?: ProviderPlanSnapshot;
  planConfigReady?: boolean;
  planPresets?: ProviderPlanPresetSuggestion[];
  routePricing?: { priceInputPerM?: number; priceOutputPerM?: number };
}

function ProviderModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  provider,
  availableProviders,
  isLoading,
  isEdit,
  planConfig,
  planSnapshot,
  planConfigReady,
  planPresets = [],
  routePricing,
}: ProviderModalProps) {
  const [selectedProvider, setSelectedProvider] = useState(provider?.provider || "");
  const [oauthState, setOauthState] = useState<
    "idle" | "connecting" | "polling" | "success" | "error"
  >("idle");
  const [deviceCode, setDeviceCode] = useState<{
    user_code: string;
    verification_uri: string;
    device_code: string;
  } | null>(null);
  const [oauthToken, setOauthToken] = useState<string>("");
  const [oauthError, setOauthError] = useState<string>("");
  const abortRef = useRef(false);
  const { addToast } = useUIStore();
  const [planPresetId, setPlanPresetId] = useState("");
  const [planName, setPlanName] = useState("");
  const [planFiveHourTokens, setPlanFiveHourTokens] = useState("");
  const [planWeeklyTokens, setPlanWeeklyTokens] = useState("");
  const [planMonthlyTokens, setPlanMonthlyTokens] = useState("");
  const [planMonthlySpend, setPlanMonthlySpend] = useState("");
  const [planPriceInput, setPlanPriceInput] = useState("");
  const [planPriceOutput, setPlanPriceOutput] = useState("");

  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(provider?.provider || availableProviders[0]?.id || "");
      setOauthState("idle");
      setDeviceCode(null);
      setOauthToken("");
      setOauthError("");
      abortRef.current = false;
    } else {
      abortRef.current = true;
    }
    return () => {
      abortRef.current = true;
    };
  }, [isOpen, provider, availableProviders]);

  useEffect(() => {
    if (!isOpen) return;
    setPlanPresetId(planConfig?.presetId ?? "");
    setPlanName(planConfig?.planName ?? "");
    setPlanFiveHourTokens(
      planConfig?.fiveHour?.tokenLimit ? String(planConfig.fiveHour.tokenLimit) : ""
    );
    setPlanWeeklyTokens(planConfig?.weekly?.tokenLimit ? String(planConfig.weekly.tokenLimit) : "");
    setPlanMonthlyTokens(
      planConfig?.monthly?.tokenLimit ? String(planConfig.monthly.tokenLimit) : ""
    );
    setPlanMonthlySpend(
      planConfig?.monthly?.spendLimit ? String(planConfig.monthly.spendLimit) : ""
    );
    setPlanPriceInput(
      routePricing?.priceInputPerM !== undefined ? String(routePricing.priceInputPerM) : ""
    );
    setPlanPriceOutput(
      routePricing?.priceOutputPerM !== undefined ? String(routePricing.priceOutputPerM) : ""
    );
  }, [isOpen, planConfig, routePricing]);

  const selectedPlanPreset = planPresets.find((preset) => preset.id === planPresetId);
  const manualPlanEditable = planSnapshot?.manualPlanEditable !== false;

  const applyPlanPreset = (presetId: string) => {
    setPlanPresetId(presetId);
    const preset = planPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    setPlanName(preset.planName);
    setPlanFiveHourTokens(preset.fiveHourTokenLimit ? String(preset.fiveHourTokenLimit) : "");
    setPlanWeeklyTokens(preset.weeklyTokenLimit ? String(preset.weeklyTokenLimit) : "");
    setPlanMonthlyTokens(preset.monthlyTokenLimit ? String(preset.monthlyTokenLimit) : "");
    setPlanMonthlySpend(preset.monthlySpendLimit ? String(preset.monthlySpendLimit) : "");
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (oauthToken) {
      formData.set("access_token", oauthToken);
    }
    onSubmit(formData);
  };

  const providerOptions = availableProviders.map((p) => ({ value: p.id, label: p.name }));
  const selectedProviderInfo = availableProviders.find((p) => p.id === selectedProvider);
  const authType = selectedProviderInfo?.authType || "api_key";

  const startDeviceCodeFlow = async () => {
    setOauthState("connecting");
    setOauthError("");
    try {
      const res = await apiFetch("/api/providers/oauth/device-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerType: selectedProvider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start OAuth flow");

      setDeviceCode({
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        device_code: data.device_code,
      });
      setOauthState("polling");

      openExternal(data.verification_uri);

      const interval = Math.max(5000, (data.interval || 5) * 1000);
      const expiresAt = Date.now() + (data.expires_in || 900) * 1000;
      pollForToken(data.device_code, interval, expiresAt);
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : "OAuth initiation failed");
      setOauthState("error");
    }
  };

  const pollForToken = async (code: string, intervalMs: number, expiresAt: number) => {
    while (Date.now() < expiresAt && !abortRef.current) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (abortRef.current) return;
      try {
        const res = await apiFetch("/api/providers/oauth/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerType: selectedProvider, deviceCode: code }),
        });
        const data = await res.json();

        if (data.status === "success" && data.access_token) {
          setOauthToken(data.access_token);
          setOauthState("success");
          addToast(
            "success",
            `${selectedProviderInfo?.name || "Provider"} connected successfully!`
          );
          return;
        }
        if (data.status === "expired" || data.status === "denied") {
          setOauthError(
            data.status === "denied" ? "Authorization was denied" : "Code expired, try again"
          );
          setOauthState("error");
          return;
        }
        if (data.status === "error") {
          setOauthError(data.error || "Unknown error");
          setOauthState("error");
          return;
        }
      } catch {}
    }
    if (!abortRef.current) {
      setOauthError("Authorization timed out. Please try again.");
      setOauthState("error");
    }
  };

  const copyCode = () => {
    if (deviceCode?.user_code) {
      navigator.clipboard.writeText(deviceCode.user_code);
      addToast("success", "Code copied to clipboard");
    }
  };

  const startRedirectOAuthFlow = async () => {
    setOauthState("connecting");
    setOauthError("");
    abortRef.current = false;
    try {
      console.log("[OAuth] Starting redirect flow for", selectedProvider);
      const res = await apiFetch("/api/providers/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerType: selectedProvider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start OAuth flow");

      console.log(
        "[OAuth] Got auth URL, opening in browser:",
        data.auth_url?.substring(0, 80) + "..."
      );

      await openExternal(data.auth_url);
      console.log("[OAuth] openExternal completed, starting poll");
      setOauthState("polling");

      const oauthStateId = data.state;
      let pollDelayMs = 3000;
      const expiresAt = Date.now() + 600_000; // 10 min timeout
      while (Date.now() < expiresAt && !abortRef.current) {
        await new Promise((r) => setTimeout(r, pollDelayMs));
        pollDelayMs = 3000;
        if (abortRef.current) return;
        try {
          const pollRes = await apiFetch("/api/providers/oauth/callback-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: oauthStateId }),
          });
          const pollData = await pollRes.json();

          if (pollRes.status === 429) {
            const retryAfterHeader = pollRes.headers.get("retry-after");
            const retryAfterSec = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 3;
            if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
              pollDelayMs = Math.max(3000, retryAfterSec * 1000);
            } else {
              pollDelayMs = 10000;
            }
            continue;
          }

          if (pollData.status === "success" && pollData.access_token) {
            setOauthToken(pollData.access_token);
            setOauthState("success");
            addToast("success", `${selectedProviderInfo?.name || "Provider"} connected!`);
            return;
          }
          if (pollData.status === "error") {
            setOauthError(pollData.error || "Authorization failed");
            setOauthState("error");
            return;
          }
        } catch {}
      }
      if (!abortRef.current) {
        setOauthError("Authorization timed out. Please try again.");
        setOauthState("error");
      }
    } catch (err) {
      console.error("[OAuth] Error:", err);
      setOauthError(err instanceof Error ? err.message : "OAuth failed");
      setOauthState("error");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEdit && (
          <Select
            name="provider"
            label="Provider Type"
            options={providerOptions}
            defaultValue={provider?.provider}
            onChange={setSelectedProvider}
            required
          />
        )}

        <Input
          name="name"
          label="Display Name"
          placeholder={
            selectedProviderInfo?.name ? `My ${selectedProviderInfo.name}` : "My Provider"
          }
          defaultValue={provider?.name}
          required
        />

        {authType === "api_key" && (
          <Input
            name="api_key"
            label="API Key"
            type="password"
            placeholder="sk-..."
            defaultValue={provider?.config?.api_key as string}
            helperText="Your API key from the provider's dashboard"
          />
        )}

        {authType === "oauth" && (
          <div className="space-y-3">
            {selectedProviderInfo?.oauthFlow === "device_code" &&
              selectedProviderInfo?.hasOAuthConfig && (
                <>
                  {oauthState === "idle" && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full justify-center"
                      leftIcon={<Shield className="w-4 h-4" />}
                      onClick={startDeviceCodeFlow}
                    >
                      Connect via OAuth
                    </Button>
                  )}

                  {oauthState === "connecting" && (
                    <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center">
                      <RefreshCw className="w-5 h-5 text-indigo-400 mx-auto animate-spin" />
                      <p className="text-sm text-indigo-300 mt-2">Initiating OAuth flow...</p>
                    </div>
                  )}

                  {oauthState === "polling" && deviceCode && (
                    <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 space-y-3">
                      <div className="flex items-center gap-2 justify-center">
                        <Shield className="w-4 h-4 text-indigo-400" />
                        <p className="text-sm text-indigo-300 font-medium">
                          Enter this code in your browser:
                        </p>
                      </div>
                      <div
                        onClick={copyCode}
                        className="text-2xl font-mono font-bold text-white text-center tracking-[0.3em] py-3 px-4 rounded-lg bg-white/10 cursor-pointer hover:bg-white/15 transition-colors"
                        title="Click to copy"
                      >
                        {deviceCode.user_code}
                      </div>
                      <p className="text-xs text-gray-400 text-center">
                        A browser window should have opened to{" "}
                        <span className="text-indigo-300">{deviceCode.verification_uri}</span>.{" "}
                        Click the code above to copy it.
                      </p>
                      <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Waiting for authorization...
                      </div>
                    </div>
                  )}

                  {oauthState === "success" && (
                    <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                      <div className="flex items-center gap-2 justify-center">
                        <Link2 className="w-5 h-5 text-green-400" />
                        <p className="text-sm font-medium text-green-300">
                          Connected successfully!
                        </p>
                      </div>
                      <p className="text-xs text-gray-400 text-center mt-1">
                        Click "Add" below to save this provider.
                      </p>
                    </div>
                  )}

                  {oauthState === "error" && (
                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 space-y-2">
                      <p className="text-sm text-red-300 text-center">{oauthError}</p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full justify-center"
                        onClick={startDeviceCodeFlow}
                      >
                        Try Again
                      </Button>
                    </div>
                  )}
                </>
              )}

            {selectedProviderInfo?.oauthFlow !== "device_code" &&
              selectedProviderInfo?.hasOAuthConfig && (
                <>
                  {oauthState === "idle" && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full justify-center"
                      leftIcon={<Shield className="w-4 h-4" />}
                      onClick={startRedirectOAuthFlow}
                    >
                      Sign in with {selectedProviderInfo?.name || "Provider"}
                    </Button>
                  )}

                  {oauthState === "connecting" && (
                    <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center">
                      <RefreshCw className="w-5 h-5 text-indigo-400 mx-auto animate-spin" />
                      <p className="text-sm text-indigo-300 mt-2">Opening sign-in page...</p>
                    </div>
                  )}

                  {oauthState === "polling" && (
                    <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 space-y-2">
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
                        <p className="text-sm text-indigo-300">Waiting for sign-in...</p>
                      </div>
                      <p className="text-xs text-gray-400 text-center">
                        Complete the sign-in in the browser window that opened. This will update
                        automatically.
                      </p>
                    </div>
                  )}

                  {oauthState === "success" && (
                    <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                      <div className="flex items-center gap-2 justify-center">
                        <Link2 className="w-5 h-5 text-green-400" />
                        <p className="text-sm font-medium text-green-300">
                          Connected successfully!
                        </p>
                      </div>
                      <p className="text-xs text-gray-400 text-center mt-1">
                        Click "Add" below to save this provider.
                      </p>
                    </div>
                  )}

                  {oauthState === "error" && (
                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 space-y-2">
                      <p className="text-sm text-red-300 text-center">
                        {oauthError || "Connection failed"}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full justify-center"
                        onClick={startRedirectOAuthFlow}
                      >
                        Try Again
                      </Button>
                    </div>
                  )}
                </>
              )}

            {selectedProviderInfo?.oauthFlow !== "device_code" &&
              !selectedProviderInfo?.hasOAuthConfig && (
                <div className="space-y-3">
                  {selectedProviderInfo?.oauthLoginUrl ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full justify-center"
                        leftIcon={<ExternalLink className="w-4 h-4" />}
                        onClick={() => openExternal(selectedProviderInfo.oauthLoginUrl!)}
                      >
                        Get API Key from {selectedProviderInfo?.name || "Provider"}
                      </Button>
                      <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                        <p className="text-xs text-gray-400 text-center">
                          Copy your API key or access token and paste it below.
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                      <div className="flex items-start gap-3">
                        <Shield className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-gray-400">
                          This provider uses OAuth. Paste your access token below.
                        </p>
                      </div>
                    </div>
                  )}
                  <Input
                    name="access_token"
                    label="Access Token"
                    type="password"
                    placeholder="Paste your token here..."
                    defaultValue={provider?.config?.access_token as string}
                  />
                </div>
              )}
          </div>
        )}

        {authType === "aws-sdk" && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-300">AWS SDK Authentication</p>
                <p className="text-xs text-gray-400 mt-1">
                  Configure AWS credentials via environment variables (AWS_ACCESS_KEY_ID,
                  AWS_SECRET_ACCESS_KEY) or AWS CLI profile.
                </p>
              </div>
            </div>
          </div>
        )}

        {authType === "none" && (
          <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
            <div className="flex items-start gap-3">
              <Link2 className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-300">No Authentication Required</p>
                <p className="text-xs text-gray-400 mt-1">
                  This provider connects directly without credentials (e.g. local Ollama instance).
                </p>
              </div>
            </div>
          </div>
        )}

        {selectedProviderInfo && (
          <div className="text-xs text-gray-500 flex items-center gap-4">
            <span>
              {selectedProviderInfo.models.length > 0
                ? `${selectedProviderInfo.models.length} model${
                    selectedProviderInfo.models.length === 1 ? "" : "s"
                  } available`
                : "No bundled models listed"}
            </span>
          </div>
        )}

        <label className="flex items-center gap-3 p-3 rounded-xl bg-white/5 cursor-pointer">
          <input
            type="checkbox"
            name="is_default"
            defaultChecked={isProviderDefault(provider)}
            className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-300">Set as default provider</span>
        </label>

        {isEdit && planConfigReady && !manualPlanEditable && (
          <div className="space-y-2 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.05] p-3">
            <div className="flex items-start gap-3">
              <Shield className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-300" />
              <div>
                <p className="text-sm font-medium text-cyan-100">Plan tracked automatically</p>
                <p className="mt-0.5 text-xs leading-5 text-gray-400">
                  Manual plan caps are hidden because this provider reports plan usage
                  automatically.
                </p>
              </div>
            </div>
          </div>
        )}

        {isEdit && planConfigReady && manualPlanEditable && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div>
              <p className="text-sm font-medium text-white">Plan limits</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Subscription coding plans use rolling 5-hour and weekly windows; pay-as-you-go API
                usage tracks a monthly budget. Leave everything empty to keep the plan unconfigured.
              </p>
            </div>
            <input type="hidden" name="plan_preset_id" value={planPresetId} />
            {planPresets.length > 0 && (
              <Select
                label="Plan preset"
                options={[
                  { value: "", label: "Custom / manual" },
                  ...planPresets.map((preset) => ({ value: preset.id, label: preset.label })),
                ]}
                value={planPresetId}
                onChange={applyPlanPreset}
                helperText={selectedPlanPreset?.limitDescription}
              />
            )}
            <Input
              name="plan_name"
              label="Plan name"
              placeholder="e.g. Pro, Max 5x, Pay-as-you-go"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                name="plan_five_hour_tokens"
                label="5-hour token limit"
                placeholder="rolling window"
                inputMode="numeric"
                value={planFiveHourTokens}
                onChange={(e) => setPlanFiveHourTokens(e.target.value)}
              />
              <Input
                name="plan_weekly_tokens"
                label="Weekly token limit"
                placeholder="rolling window"
                inputMode="numeric"
                value={planWeeklyTokens}
                onChange={(e) => setPlanWeeklyTokens(e.target.value)}
              />
              <Input
                name="plan_monthly_tokens"
                label="Monthly token limit"
                placeholder="billing month"
                inputMode="numeric"
                value={planMonthlyTokens}
                onChange={(e) => setPlanMonthlyTokens(e.target.value)}
              />
              <Input
                name="plan_monthly_spend"
                label="Monthly budget"
                placeholder="e.g. 100"
                inputMode="decimal"
                value={planMonthlySpend}
                onChange={(e) => setPlanMonthlySpend(e.target.value)}
              />
            </div>
          </div>
        )}

        {isEdit && planConfigReady && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div>
              <p className="text-sm font-medium text-white">Cost estimation</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Custom per-token pricing overrides the built-in model catalog when estimating spend.
                Leave blank to use catalog prices.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                name="plan_price_input"
                label="$ / 1M input tokens"
                placeholder="catalog price"
                inputMode="decimal"
                value={planPriceInput}
                onChange={(e) => setPlanPriceInput(e.target.value)}
              />
              <Input
                name="plan_price_output"
                label="$ / 1M output tokens"
                placeholder="catalog price"
                inputMode="decimal"
                value={planPriceOutput}
                onChange={(e) => setPlanPriceOutput(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isLoading}>
            {isEdit ? "Update" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
