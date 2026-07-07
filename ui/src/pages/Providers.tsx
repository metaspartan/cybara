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
import type {
  Provider,
  AvailableProvider,
  ProviderPlanMonitoringConfig,
  ProviderPlanProviderConfig,
  ProviderPlanSnapshot,
  ProviderPlanStatusResponse,
} from "@/types";

function parsePlanLimitInput(value: FormDataEntryValue | null): number | undefined {
  const parsed = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function providerPlanStatusClass(status: ProviderPlanSnapshot["status"]): string {
  if (status === "ok") return "text-emerald-300";
  if (status === "warning") return "text-amber-300";
  if (status === "exhausted") return "text-red-300";
  if (status === "disabled") return "text-gray-500";
  return "text-gray-400";
}

function providerPlanProgress(plan: ProviderPlanSnapshot): number | null {
  const usage = plan.windows
    .map((window) => window.usedPercent)
    .filter((value): value is number => typeof value === "number");
  if (usage.length === 0) return null;
  return Math.min(100, Math.max(...usage));
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
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

  const planConfigForProvider = (provider: Provider): ProviderPlanProviderConfig | undefined =>
    providerPlanConfig?.providers[provider.id] ?? providerPlanConfig?.providers[provider.provider];

  const savePlanLimits = async (provider: Provider, formData: FormData) => {
    if (!providerPlanConfig) return;
    const planName = String(formData.get("plan_name") ?? "").trim();
    const tokenLimit = parsePlanLimitInput(formData.get("plan_monthly_tokens"));
    const spendLimit = parsePlanLimitInput(formData.get("plan_monthly_spend"));
    const existing = planConfigForProvider(provider);
    const hasInput = Boolean(planName) || tokenLimit !== undefined || spendLimit !== undefined;
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
      nextProviders[key] = {
        ...(existing || {}),
        enabled: true,
        planName: planName || undefined,
        monthly:
          tokenLimit !== undefined || spendLimit !== undefined
            ? {
                ...(existing?.monthly || {}),
                enabled: true,
                tokenLimit,
                spendLimit,
              }
            : existing?.monthly,
      };
    }
    const payload = { ...providerPlanConfig, enabled: true, providers: nextProviders };
    const response = await providerPlansApi.updateConfig(payload);
    if (!response.success) {
      throw new Error(response.error || "Failed to save plan limits");
    }
    setProviderPlanConfig("data" in response && response.data ? response.data : payload);
    const status = await providerPlansApi.status();
    if (status.success) setProviderPlanStatus(status.data ?? null);
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
                          {provider.is_default && (
                            <Badge variant="success" size="sm">
                              <Star className="w-3 h-3 mr-1" />
                              Default
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-400 capitalize">{provider.provider}</p>
                        <ProviderPlanSummary
                          plan={
                            providerPlanByKey.get(provider.id) ??
                            providerPlanByKey.get(provider.provider)
                          }
                        />
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
          planConfigReady={providerPlanConfig !== null}
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
  const progress = providerPlanProgress(plan);
  const source = plan.sourceLabel || plan.source?.replace(/_/g, " ") || "Local Cybara usage";
  const externalSource = plan.externalSourceAvailable
    ? plan.externalSourceLabel || "External billing source available"
    : null;

  return (
    <div className="mt-2 w-full max-w-xl rounded-lg border border-white/10 bg-white/[0.035] p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={`font-medium ${providerPlanStatusClass(plan.status)}`}>
          {plan.status.replace("_", " ")}
        </span>
        <span className="text-gray-400">{source}</span>
        <span className="text-gray-500">{formatCompactNumber(plan.localTokens30d)} tokens 30d</span>
        {plan.localSpend30d > 0 && (
          <span className="text-gray-500">${plan.localSpend30d.toFixed(2)} local 30d</span>
        )}
      </div>
      {progress !== null && (
        <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-cyan-400"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
      {externalSource && (
        <p className="mt-1 text-[11px] leading-4 text-gray-500">
          {externalSource}: {plan.externalSourceHint}
        </p>
      )}
    </div>
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
  planConfigReady?: boolean;
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
  planConfigReady,
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
            defaultChecked={provider?.is_default}
            className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-300">Set as default provider</span>
        </label>

        {isEdit && planConfigReady && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div>
              <p className="text-sm font-medium text-white">Plan limits</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Track monthly usage against your provider plan. Leave all fields empty to keep the
                plan unconfigured. Advanced windows and presets live in Model Router settings.
              </p>
            </div>
            <Input
              name="plan_name"
              label="Plan name"
              placeholder="e.g. Pro, Team, Pay-as-you-go"
              defaultValue={planConfig?.planName ?? ""}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                name="plan_monthly_tokens"
                label="Monthly token limit"
                placeholder="e.g. 10000000"
                inputMode="numeric"
                defaultValue={
                  planConfig?.monthly?.tokenLimit ? String(planConfig.monthly.tokenLimit) : ""
                }
              />
              <Input
                name="plan_monthly_spend"
                label="Monthly spend limit"
                placeholder="e.g. 100"
                inputMode="decimal"
                defaultValue={
                  planConfig?.monthly?.spendLimit ? String(planConfig.monthly.spendLimit) : ""
                }
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
