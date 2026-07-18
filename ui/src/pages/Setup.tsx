import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Cloud,
  Bot,
  CheckCircle,
  ChevronRight,
  Key,
  Loader2,
  AlertCircle,
  Shield,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { ProviderIcon, hasProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  useAvailableProviders,
  useCreateProvider,
  useCreateAgent,
  useProviderModels,
} from "@/hooks/useApi";
import { useProviderOAuth, type ProviderOAuthCredentials } from "@/hooks/useProviderOAuth";
import { setupApi, settingsApi } from "@/lib/api";
import { commitSetupComplete } from "@/lib/setupGate";
import type { AvailableProvider, Provider } from "@/types";

type WizardStep =
  | "welcome"
  | "provider"
  | "apikey"
  | "oauth"
  | "permissions"
  | "agent"
  | "complete";
type SetupAuthFlow = "api_key" | "oauth" | "external" | "none";

function getAuthFlow(provider: AvailableProvider): SetupAuthFlow {
  if (!provider.authType || provider.authType === "none") return "none";
  if (provider.authType === "oauth") return "oauth";
  if (provider.authType === "aws-sdk") return "external";
  return "api_key";
}

function credentialCopy(provider: AvailableProvider): {
  title: string;
  description: string;
  placeholder: string;
} {
  if (provider.authType === "token" || provider.authType === "bearer") {
    return {
      title: "Enter Access Token",
      description: `Add your ${provider.name} access token`,
      placeholder: "Paste your access token",
    };
  }
  return {
    title: "Enter API Key",
    description: `Add your ${provider.name} API key`,
    placeholder: "Paste your API key",
  };
}

export function Setup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>("welcome");
  const [selectedProvider, setSelectedProvider] = useState<AvailableProvider | null>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [toolApprovalMode, setToolApprovalMode] = useState<"always_allow" | "ask">("always_allow");
  const [apiKey, setApiKey] = useState("");
  const [configuredProvider, setConfiguredProvider] = useState<Provider | null>(null);
  const [agentName, setAgentName] = useState("My Agent");
  const [agentModel, setAgentModel] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentCreated, setAgentCreated] = useState(false);

  const {
    data: availableProviders,
    isLoading: availableLoading,
    error: availableError,
    refetch: refetchAvailable,
  } = useAvailableProviders();
  const createProvider = useCreateProvider();
  const createAgent = useCreateAgent();
  const oauth = useProviderOAuth(selectedProvider);
  const {
    data: discoveredModels,
    isLoading: modelsLoading,
    refetch: refetchModels,
  } = useProviderModels(configuredProvider?.id);
  const progressSteps: WizardStep[] = [
    "welcome",
    "provider",
    "apikey",
    "permissions",
    "agent",
    "complete",
  ];
  const filteredProviders = (availableProviders || []).filter((provider) => {
    const search = providerSearch.trim().toLowerCase();
    if (!search) return true;
    return (
      provider.name.toLowerCase().includes(search) || provider.id.toLowerCase().includes(search)
    );
  });
  const selectedCredentialCopy = selectedProvider ? credentialCopy(selectedProvider) : null;

  useEffect(() => {
    if (!discoveredModels?.length) return;
    if (!discoveredModels.some((model) => model.model_id === agentModel)) {
      setAgentModel(discoveredModels[0].model_id);
    }
  }, [agentModel, discoveredModels]);

  const handleProviderSelect = (provider: AvailableProvider) => {
    setSelectedProvider(provider);
    setAgentModel("");
    setError(null);

    const authFlow = getAuthFlow(provider);

    if (authFlow === "api_key") {
      setStep("apikey");
    } else if (authFlow === "oauth") {
      setStep("oauth");
    } else {
      handleCreateProvider(provider.id, "");
    }
  };

  const handleCreateProvider = async (
    providerId: string,
    key: string,
    oauthCredentials?: ProviderOAuthCredentials
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const created = await createProvider.mutateAsync({
        provider: providerId,
        name:
          availableProviders?.find((provider) => provider.id === providerId)?.name || providerId,
        api_key: key || undefined,
        access_token: oauthCredentials?.access_token,
        refresh_token: oauthCredentials?.refresh_token,
        expires_at: oauthCredentials?.expires_at,
        is_default: true,
      });
      setConfiguredProvider(created);
      setStep("permissions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create provider");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthConnect = async () => {
    const credentials = await oauth.connect();
    if (selectedProvider && credentials) {
      await handleCreateProvider(selectedProvider.id, "", credentials);
    }
  };

  const handleConfigurePermissions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await settingsApi.updateConfig({
        tool_approval_mode: toolApprovalMode,
      });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Failed to save permissions");
      }
      setStep("agent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save permissions");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAgent = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!configuredProvider) throw new Error("Connect a provider before creating an agent");
      if (!agentCreated) {
        await createAgent.mutateAsync({
          name: agentName.trim(),
          type: "main",
          model: agentModel,
          provider_id: configuredProvider.id,
        });
        setAgentCreated(true);
      }
      await completeSetup();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
      setIsLoading(false);
    }
  };

  const handleSkipAgent = async () => {
    await completeSetup();
  };

  const completeSetup = async () => {
    try {
      const result = await setupApi.complete();
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Failed to complete setup");
      }
      commitSetupComplete((key, value) => queryClient.setQueryData(key, value));
      setStep("complete");
    } catch (err) {
      setError("Failed to complete setup");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoToDashboard = () => {
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-backdrop)] text-[var(--text-primary)]">
      <div className="w-full max-w-xl mx-auto px-4">
        <div className="flex items-center justify-center mb-8">
          {progressSteps.map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${
                  step === s || (step === "oauth" && s === "apikey")
                    ? "bg-[rgb(var(--accent-primary))]"
                    : progressSteps.indexOf(step) > i || (step === "oauth" && i < 2)
                      ? "bg-emerald-500"
                      : "bg-[var(--surface-border)]"
                }`}
              />
              {i < progressSteps.length - 1 && (
                <div
                  className={`w-8 h-0.5 mx-1.5 shrink-0 transition-colors ${
                    progressSteps.indexOf(step) > i || (step === "oauth" && i < 2)
                      ? "bg-emerald-500"
                      : "bg-[var(--surface-border)]"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <Card variant="liquid">
          <CardContent className="p-8">
            {step === "welcome" && (
              <div className="text-center space-y-6">
                <div className="w-20 h-20 mx-auto flex items-center justify-center">
                  <img
                    src="/cybara.png"
                    alt="Cybara"
                    className={"w-full h-full object-cover transition-all duration-300"}
                  />
                </div>
                <div>
                  <h1 className="mb-2 text-3xl font-bold text-[var(--text-primary)]">
                    Welcome to Cybara!
                  </h1>
                  <p className="text-lg text-[var(--text-muted)]">
                    Let's get you set up in just a few steps
                  </p>
                </div>
                <div className="text-left space-y-3 py-4">
                  <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                    <Cloud className="h-5 w-5 shrink-0 text-[rgb(var(--accent-primary))]" />
                    <span>Connect an AI provider</span>
                  </div>
                  <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                    <Bot className="h-5 w-5 shrink-0 text-[rgb(var(--accent-primary))]" />
                    <span>Create your first AI agent</span>
                  </div>
                  <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                    <Shield className="h-5 w-5 shrink-0 text-[rgb(var(--accent-primary))]" />
                    <span>Choose tool permission mode</span>
                  </div>
                  <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                    <CheckCircle className="h-5 w-5 shrink-0 text-[rgb(var(--accent-primary))]" />
                    <span>Start chatting and building</span>
                  </div>
                </div>
                <Button size="lg" onClick={() => setStep("provider")} className="w-full">
                  Get Started <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            )}

            {step === "provider" && (
              <div className="space-y-6">
                <div className="text-center">
                  <h2 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
                    Choose AI Provider
                  </h2>
                  <p className="text-[var(--text-muted)]">Select which AI service to connect</p>
                </div>
                <Input
                  type="text"
                  placeholder="Search providers..."
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                />
                {availableLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-[rgb(var(--accent-primary))]" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
                    {filteredProviders.map((provider) => {
                      const authFlow = getAuthFlow(provider);
                      return (
                        <button
                          type="button"
                          key={provider.id}
                          onClick={() => handleProviderSelect(provider)}
                          className="group relative flex items-center gap-2.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-raised)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--text-primary)]">
                            {hasProviderIcon(provider.id) ? (
                              <ProviderIcon provider={provider.id} size={20} />
                            ) : (
                              <Cloud className="h-4 w-4 text-[var(--icon-muted)]" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)] transition-colors group-hover:text-[rgb(var(--accent-primary))]">
                            {provider.name}
                          </span>
                          {authFlow === "none" && (
                            <span className="absolute top-1 right-1 text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded">
                              Local
                            </span>
                          )}
                          {authFlow === "oauth" && (
                            <span className="absolute top-1 right-1 text-[10px] bg-amber-500/20 text-amber-400 px-1 rounded">
                              OAuth
                            </span>
                          )}
                          {authFlow === "external" && (
                            <span className="absolute top-1 right-1 text-[10px] bg-blue-500/20 text-blue-300 px-1 rounded">
                              External
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {filteredProviders.length === 0 && (
                      <div className="col-span-2 py-8 text-center text-sm text-[var(--text-muted)]">
                        {availableError ? (
                          <div className="space-y-2">
                            <p className="text-red-400">Couldn't load the provider list.</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void refetchAvailable()}
                            >
                              Retry
                            </Button>
                          </div>
                        ) : (availableProviders?.length ?? 0) === 0 ? (
                          "No providers available yet."
                        ) : (
                          <>No providers match &ldquo;{providerSearch}&rdquo;.</>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-[var(--text-muted)]">
                    {availableProviders?.length
                      ? `${filteredProviders.length} of ${availableProviders.length} providers`
                      : ""}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setStep("permissions")}>
                    Skip for now
                  </Button>
                </div>
              </div>
            )}

            {step === "apikey" && selectedProvider && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--surface-raised)]">
                    <Key className="h-8 w-8 text-[rgb(var(--accent-primary))]" />
                  </div>
                  <h2 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
                    {selectedCredentialCopy?.title}
                  </h2>
                  <p className="text-[var(--text-muted)]">{selectedCredentialCopy?.description}</p>
                </div>

                <div className="space-y-4">
                  <Input
                    type="password"
                    placeholder={selectedCredentialCopy?.placeholder}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="text-lg"
                  />

                  {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                  <div className="flex gap-3">
                    <Button variant="ghost" onClick={() => setStep("provider")} className="flex-1">
                      Back
                    </Button>
                    <Button
                      onClick={() => handleCreateProvider(selectedProvider.id, apiKey)}
                      disabled={!apiKey.trim() || isLoading}
                      isLoading={isLoading}
                      className="flex-1"
                    >
                      Continue
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep("permissions")}
                    className="w-full text-center text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            )}

            {step === "oauth" && selectedProvider && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--surface-raised)]">
                    <AlertCircle className="h-8 w-8 text-[rgb(var(--accent-primary))]" />
                  </div>
                  <h2 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
                    OAuth Required
                  </h2>
                  <p className="text-[var(--text-muted)]">
                    {selectedProvider.name} requires OAuth authentication
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-sm text-amber-200">
                    Sign in securely to connect {selectedProvider.name}. Cybara stores the returned
                    credentials in its encrypted provider store.
                  </p>
                </div>

                {oauth.state === "polling" && oauth.deviceCode && (
                  <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center space-y-2">
                    <p className="text-sm text-indigo-200">Finish authorization in your browser</p>
                    <button
                      type="button"
                      onClick={() => {
                        const code = oauth.deviceCode?.user_code;
                        if (code) void navigator.clipboard.writeText(code);
                      }}
                      className="text-2xl font-mono font-bold text-white tracking-[0.25em]"
                    >
                      {oauth.deviceCode.user_code}
                    </button>
                    <p className="text-xs text-[var(--text-muted)]">Waiting for authorization…</p>
                  </div>
                )}

                {(error || oauth.error) && (
                  <p className="text-red-400 text-sm text-center">{error || oauth.error}</p>
                )}

                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep("provider")} className="flex-1">
                    Back
                  </Button>
                  <Button
                    onClick={handleOAuthConnect}
                    isLoading={
                      oauth.state === "connecting" || oauth.state === "polling" || isLoading
                    }
                    disabled={!selectedProvider.hasOAuthConfig}
                    className="flex-1"
                  >
                    {oauth.state === "error"
                      ? "Try Again"
                      : `Sign in with ${selectedProvider.name}`}
                  </Button>
                </div>
                {!selectedProvider.hasOAuthConfig && (
                  <p className="text-xs text-amber-300 text-center">
                    OAuth is unavailable until this provider's client configuration is installed.
                  </p>
                )}
              </div>
            )}

            {step === "permissions" && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--surface-raised)]">
                    <Shield className="h-8 w-8 text-[rgb(var(--accent-primary))]" />
                  </div>
                  <h2 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
                    Tool Permissions
                  </h2>
                  <p className="text-[var(--text-muted)]">
                    Choose how dangerous tools should be handled
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setToolApprovalMode("always_allow")}
                    className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                      toolApprovalMode === "always_allow"
                        ? "border-[rgb(var(--accent-primary))] bg-[rgba(var(--accent-primary),0.10)]"
                        : "border-[var(--surface-border)] bg-[var(--surface-raised)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <p className="text-sm font-medium text-[var(--text-primary)]">Always Allow</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Run tools immediately in chat and channels.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setToolApprovalMode("ask")}
                    className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                      toolApprovalMode === "ask"
                        ? "border-[rgb(var(--accent-primary))] bg-[rgba(var(--accent-primary),0.10)]"
                        : "border-[var(--surface-border)] bg-[var(--surface-raised)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <p className="text-sm font-medium text-[var(--text-primary)]">Ask Me First</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Require confirmation before dangerous tool calls.
                    </p>
                  </button>
                </div>

                {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep("provider")} className="flex-1">
                    Back
                  </Button>
                  <Button
                    onClick={handleConfigurePermissions}
                    isLoading={isLoading}
                    className="flex-1"
                  >
                    Continue
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() => setStep("agent")}
                  className="w-full text-center text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                >
                  Skip for now
                </button>
              </div>
            )}

            {step === "agent" && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--surface-raised)]">
                    <Bot className="h-8 w-8 text-[rgb(var(--accent-primary))]" />
                  </div>
                  <h2 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
                    Create Your Agent
                  </h2>
                  <p className="text-[var(--text-muted)]">
                    Configure an agent with your connected provider
                  </p>
                </div>

                <div className="space-y-4">
                  <Input
                    label="Agent name"
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    placeholder="My Agent"
                  />
                  <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
                    <span>Model</span>
                    <select
                      value={agentModel}
                      onChange={(event) => setAgentModel(event.target.value)}
                      className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-raised)] px-3 py-2.5 text-[var(--text-primary)]"
                      disabled={modelsLoading || !discoveredModels?.length}
                    >
                      {modelsLoading && <option value="">Discovering models…</option>}
                      {!modelsLoading && !discoveredModels?.length && (
                        <option value="">No models discovered</option>
                      )}
                      {(discoveredModels || []).map((model) => (
                        <option key={model.id} value={model.model_id}>
                          {model.model_name || model.model_id}
                          {model.context_window
                            ? ` (${Math.round(model.context_window / 1024)}K context)`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!modelsLoading && !discoveredModels?.length && configuredProvider && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void refetchModels()}
                      className="w-full justify-center"
                    >
                      Discover Models Again
                    </Button>
                  )}
                  {configuredProvider && (
                    <p className="text-xs text-[var(--text-muted)]">
                      Using {configuredProvider.name}
                    </p>
                  )}
                </div>

                {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                <div className="flex gap-3">
                  <Button variant="ghost" onClick={handleSkipAgent} className="flex-1">
                    Skip for Now
                  </Button>
                  <Button
                    onClick={handleCreateAgent}
                    isLoading={isLoading}
                    disabled={!configuredProvider || !agentName.trim() || !agentModel}
                    className="flex-1"
                  >
                    Create Agent
                  </Button>
                </div>
              </div>
            )}

            {step === "complete" && (
              <div className="text-center space-y-6">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--surface-raised)]">
                  <CheckCircle className="h-10 w-10 text-[rgb(var(--accent-primary))]" />
                </div>
                <div>
                  <h1 className="mb-2 text-3xl font-bold text-[var(--text-primary)]">
                    You're All Set!
                  </h1>
                  <p className="text-lg text-[var(--text-muted)]">Cybara is ready to use</p>
                </div>
                <Button size="lg" onClick={handleGoToDashboard} className="w-full">
                  Go to Dashboard <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
