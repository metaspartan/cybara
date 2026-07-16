import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { extractApiError, settingsApi } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { AlertTriangle, RefreshCw, Server, Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type SandboxProviderOption = "auto" | "apple_sandbox" | "podman" | "docker" | "remote";

interface SandboxStatusView {
  enabled: boolean;
  configuredProvider: SandboxProviderOption;
  network: "allow" | "deny";
  resolvedProvider: "apple_sandbox" | "podman" | "docker" | "remote" | null;
  available: boolean;
  reason?: string;
  providers: Array<{
    provider: "apple_sandbox" | "podman" | "docker" | "remote";
    supported: boolean;
    installed: boolean;
    available: boolean;
    reason?: string;
  }>;
  checkedAt: string;
  lastEvent: {
    phase: "prepared" | "disabled" | "error";
    provider: "apple_sandbox" | "podman" | "docker" | "remote" | "host" | null;
    commandPreview?: string;
    cwd?: string;
    network?: "allow" | "deny";
    reason?: string;
    timestamp: string;
  } | null;
}

export function FeatureSettings() {
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [acpEnabled, setAcpEnabled] = useState(true);
  const [dangerousToolPolicyEnabled, setDangerousToolPolicyEnabled] = useState(false);
  const [dangerousToolPolicyMode, setDangerousToolPolicyMode] = useState<"audit" | "block">(
    "audit"
  );
  const [toolApprovalMode, setToolApprovalMode] = useState<"always_allow" | "ask">("always_allow");
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [sandboxProvider, setSandboxProvider] = useState<SandboxProviderOption>("auto");
  const [sandboxNetwork, setSandboxNetwork] = useState<"allow" | "deny">("deny");
  const [sandboxRemoteUrl, setSandboxRemoteUrl] = useState("");
  const [sandboxRemoteApiKey, setSandboxRemoteApiKey] = useState("");
  const [savingToolApprovalMode, setSavingToolApprovalMode] = useState(false);
  const [savingDangerousPolicy, setSavingDangerousPolicy] = useState(false);
  const [savingSandboxRuntime, setSavingSandboxRuntime] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSandboxStatus, setLoadingSandboxStatus] = useState(true);
  const [refreshingSandboxStatus, setRefreshingSandboxStatus] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatusView | null>(null);
  const { addToast } = useUIStore();

  const providerLabel = (provider: SandboxProviderOption | "host" | null): string => {
    if (provider === "apple_sandbox") return "Apple Sandbox";
    if (provider === "podman") return "Podman";
    if (provider === "docker") return "Docker";
    if (provider === "remote") return "Remote";
    if (provider === "host") return "Host";
    if (provider === "auto") return "Auto Detect";
    return "None";
  };

  const refreshSandboxStatus = useCallback(
    async (silent = false): Promise<SandboxStatusView | null> => {
      if (!silent) {
        setRefreshingSandboxStatus(true);
      } else {
        setLoadingSandboxStatus(true);
      }
      try {
        const result = await settingsApi.getSandboxStatus();
        if (result.success && result.data) {
          const nextStatus = result.data as SandboxStatusView;
          setSandboxStatus(nextStatus);
          return nextStatus;
        }
        return null;
      } catch {
        return null;
      } finally {
        setLoadingSandboxStatus(false);
        if (!silent) setRefreshingSandboxStatus(false);
      }
    },
    []
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshSandboxStatus(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshSandboxStatus]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [configResult, sandboxResult] = await Promise.all([
          settingsApi.getConfig(),
          settingsApi.getSandboxStatus(),
        ]);
        if (!mounted) return;

        const data = configResult.success ? configResult.data : undefined;
        setTerminalEnabled(data?.terminal_enabled === true);
        setAcpEnabled(data?.acp_enabled !== false);
        const policy = data?.dangerous_tool_policy as
          | { enabled?: boolean; mode?: string }
          | undefined;
        const modeRaw = typeof data?.tool_approval_mode === "string" ? data.tool_approval_mode : "";
        const sandboxRaw = data?.sandbox_runtime as
          | {
              enabled?: boolean;
              provider?: string;
              network?: string;
              remoteUrl?: string;
              remoteApiKey?: string;
            }
          | undefined;
        setDangerousToolPolicyEnabled(policy?.enabled === true);
        setDangerousToolPolicyMode(policy?.mode === "block" ? "block" : "audit");
        setToolApprovalMode(modeRaw === "ask" ? "ask" : "always_allow");
        setSandboxEnabled(sandboxRaw?.enabled === true);
        setSandboxProvider(
          sandboxRaw?.provider === "apple_sandbox" ||
            sandboxRaw?.provider === "podman" ||
            sandboxRaw?.provider === "docker" ||
            sandboxRaw?.provider === "remote"
            ? sandboxRaw.provider
            : "auto"
        );
        setSandboxNetwork(sandboxRaw?.network === "allow" ? "allow" : "deny");
        setSandboxRemoteUrl(typeof sandboxRaw?.remoteUrl === "string" ? sandboxRaw.remoteUrl : "");
        setSandboxRemoteApiKey(
          typeof sandboxRaw?.remoteApiKey === "string" ? sandboxRaw.remoteApiKey : ""
        );
        if (sandboxResult.success && sandboxResult.data) {
          setSandboxStatus(sandboxResult.data as SandboxStatusView);
        }
      } finally {
        if (mounted) {
          setLoading(false);
          setLoadingSandboxStatus(false);
        }
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const toggleTerminal = async (enabled: boolean) => {
    setTerminalEnabled(enabled);
    try {
      const result = await settingsApi.updateConfig({ terminal_enabled: enabled });
      if (!result.success || !result.data?.success) {
        throw new Error(extractApiError(result, "Config update failed"));
      }
      addToast("success", `Web terminal ${enabled ? "enabled" : "disabled"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update terminal setting";
      addToast("error", message);
      setTerminalEnabled(!enabled);
    }
  };

  const toggleAcp = async (enabled: boolean) => {
    setAcpEnabled(enabled);
    try {
      const result = await settingsApi.updateConfig({ acp_enabled: enabled });
      if (!result.success || !result.data?.success) {
        throw new Error(extractApiError(result, "Config update failed"));
      }
      addToast("success", `ACP server ${enabled ? "enabled" : "disabled"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update ACP setting";
      addToast("error", message);
      setAcpEnabled(!enabled);
    }
  };

  const updateDangerousPolicy = async (next: { enabled: boolean; mode: "audit" | "block" }) => {
    const previous = {
      enabled: dangerousToolPolicyEnabled,
      mode: dangerousToolPolicyMode,
    };

    setDangerousToolPolicyEnabled(next.enabled);
    setDangerousToolPolicyMode(next.mode);
    setSavingDangerousPolicy(true);
    try {
      const result = await settingsApi.updateConfig({ dangerous_tool_policy: next });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast(
        "success",
        `Dangerous tool policy ${next.enabled ? `${next.mode} mode` : "disabled"}`
      );
    } catch {
      setDangerousToolPolicyEnabled(previous.enabled);
      setDangerousToolPolicyMode(previous.mode);
      addToast("error", "Failed to update dangerous tool policy");
    } finally {
      setSavingDangerousPolicy(false);
    }
  };

  const updateToolApprovalMode = async (nextMode: "always_allow" | "ask") => {
    const previousMode = toolApprovalMode;
    setToolApprovalMode(nextMode);
    setSavingToolApprovalMode(true);
    try {
      const result = await settingsApi.updateConfig({ tool_approval_mode: nextMode });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast(
        "success",
        nextMode === "ask" ? "Tool approvals set to Ask Me" : "Tool approvals set to Always Allow"
      );
    } catch {
      setToolApprovalMode(previousMode);
      addToast("error", "Failed to update tool approval mode");
    } finally {
      setSavingToolApprovalMode(false);
    }
  };

  const updateSandboxRuntime = async (
    next: {
      enabled: boolean;
      provider: SandboxProviderOption;
      network: "allow" | "deny";
      remoteUrl?: string;
      remoteApiKey?: string;
    },
    successMessage?: string
  ): Promise<boolean> => {
    const previous = {
      enabled: sandboxEnabled,
      provider: sandboxProvider,
      network: sandboxNetwork,
      remoteUrl: sandboxRemoteUrl,
      remoteApiKey: sandboxRemoteApiKey,
    };

    const payload = {
      enabled: next.enabled,
      provider: next.provider,
      network: next.network,
      remoteUrl: next.remoteUrl ?? sandboxRemoteUrl,
      remoteApiKey: next.remoteApiKey ?? sandboxRemoteApiKey,
    };

    setSandboxEnabled(next.enabled);
    setSandboxProvider(next.provider);
    setSandboxNetwork(next.network);
    if (next.remoteUrl !== undefined) setSandboxRemoteUrl(next.remoteUrl);
    if (next.remoteApiKey !== undefined) setSandboxRemoteApiKey(next.remoteApiKey);
    setSavingSandboxRuntime(true);
    try {
      const result = await settingsApi.updateConfig({ sandbox_runtime: payload });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      const refreshedStatus = await refreshSandboxStatus(true);
      if (next.enabled && refreshedStatus && !refreshedStatus.available) {
        addToast(
          "error",
          `Sandbox unavailable: ${refreshedStatus.reason || "No compatible provider on this machine"}`
        );
      } else {
        addToast(
          "success",
          successMessage ?? (next.enabled ? "Sandbox runtime enabled" : "Sandbox runtime disabled")
        );
      }
      return true;
    } catch {
      setSandboxEnabled(previous.enabled);
      setSandboxProvider(previous.provider);
      setSandboxNetwork(previous.network);
      setSandboxRemoteUrl(previous.remoteUrl);
      setSandboxRemoteApiKey(previous.remoteApiKey);
      addToast("error", "Failed to update sandbox runtime");
      return false;
    } finally {
      setSavingSandboxRuntime(false);
    }
  };

  const saveRemoteSandbox = async (): Promise<void> => {
    const remoteUrl = sandboxRemoteUrl.trim();
    if (!remoteUrl) {
      addToast("error", "Enter a remote sandbox URL");
      return;
    }
    await updateSandboxRuntime(
      {
        enabled: sandboxEnabled,
        provider: "remote",
        network: sandboxNetwork,
        remoteUrl,
        remoteApiKey: sandboxRemoteApiKey.trim(),
      },
      "Remote sandbox saved"
    );
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Runtime Safety
        </CardTitle>
        <CardDescription>Control exposed services, tool guardrails, and isolation</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
          Platform access
        </p>
        <div className="flex items-center justify-between border-b border-[var(--surface-border)] py-3">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Web Terminal</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Enable browser-based terminal access for this gateway. Applies immediately and is also
              available via the{" "}
              <code className="text-[rgb(var(--accent-primary))]">--enable-terminal</code> flag.
            </p>
          </div>
          <Switch
            checked={terminalEnabled}
            disabled={loading}
            onChange={(value) => void toggleTerminal(value)}
          />
        </div>

        <div className="flex items-center justify-between border-b border-[var(--surface-border)] py-3">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">ACP Server</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Let external editors drive this agent over the Agent Client Protocol (
              <code className="text-[rgb(var(--accent-primary))]">cybara acp</code> on stdio). When
              off, the ACP server refuses to start.
            </p>
          </div>
          <Switch
            checked={acpEnabled}
            disabled={loading}
            onChange={(value) => void toggleAcp(value)}
          />
        </div>

        <div className="border-b border-[var(--surface-border)] py-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
            Tool guardrails
          </p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Dangerous Tool Policy
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Guardrails for high-impact tools like shell execution, wallet signing, and external
                actions.
              </p>
            </div>
            <Switch
              checked={dangerousToolPolicyEnabled}
              disabled={loading || savingDangerousPolicy}
              onChange={(value) =>
                void updateDangerousPolicy({
                  enabled: value,
                  mode: dangerousToolPolicyMode,
                })
              }
            />
          </div>
          {dangerousToolPolicyEnabled && (
            <div className="mt-3 max-w-xs">
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Mode</label>
              <Select
                value={dangerousToolPolicyMode}
                onChange={(value) =>
                  updateDangerousPolicy({
                    enabled: true,
                    mode: value === "block" ? "block" : "audit",
                  })
                }
                options={[
                  { value: "audit", label: "Audit (log only)" },
                  { value: "block", label: "Block dangerous tools" },
                ]}
              />
            </div>
          )}
        </div>

        <div className="border-b border-[var(--surface-border)] py-3">
          <p className="text-sm font-medium text-[var(--text-primary)]">Tool Approvals</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Choose how dangerous tools are handled across chat, Telegram, Discord, Slack, Signal,
            iMessage, and WhatsApp.
          </p>
          <div className="mt-3 max-w-xs">
            <Select
              value={toolApprovalMode}
              onChange={(value) =>
                void updateToolApprovalMode(value === "ask" ? "ask" : "always_allow")
              }
              options={[
                { value: "always_allow", label: "Always Allow" },
                { value: "ask", label: "Ask Me First" },
              ]}
              disabled={loading || savingToolApprovalMode}
            />
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-subtle)]">
            Channel shortcut:{" "}
            <code className="text-[rgb(var(--accent-primary))]">/permissions ask</code> or{" "}
            <code className="text-[rgb(var(--accent-primary))]">/permissions allow</code>
          </p>
        </div>

        <div className="py-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
            Command isolation
          </p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Command Sandbox</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Isolate `exec` and `git` tools with a local or remote runtime.
              </p>
            </div>
            <Switch
              checked={sandboxEnabled}
              disabled={loading || savingSandboxRuntime}
              onChange={(value) =>
                void updateSandboxRuntime({
                  enabled: value,
                  provider: sandboxProvider,
                  network: sandboxNetwork,
                })
              }
            />
          </div>
          {sandboxEnabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-muted)]">Provider</label>
                <Select
                  value={sandboxProvider}
                  onChange={(value) =>
                    void updateSandboxRuntime({
                      enabled: true,
                      provider:
                        value === "apple_sandbox" ||
                        value === "podman" ||
                        value === "docker" ||
                        value === "remote"
                          ? value
                          : "auto",
                      network: sandboxNetwork,
                    })
                  }
                  options={[
                    { value: "auto", label: "Auto Detect" },
                    { value: "apple_sandbox", label: "Apple Sandbox" },
                    { value: "podman", label: "Podman" },
                    { value: "docker", label: "Docker" },
                    { value: "remote", label: "Remote" },
                  ]}
                  disabled={savingSandboxRuntime}
                />
              </div>
              {sandboxProvider !== "remote" ? (
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-muted)]">Network</label>
                  <Select
                    value={sandboxNetwork}
                    onChange={(value) =>
                      void updateSandboxRuntime({
                        enabled: true,
                        provider: sandboxProvider,
                        network: value === "allow" ? "allow" : "deny",
                      })
                    }
                    options={[
                      { value: "deny", label: "Deny Network" },
                      { value: "allow", label: "Allow Network" },
                    ]}
                    disabled={savingSandboxRuntime}
                  />
                </div>
              ) : null}
            </div>
          )}
          {sandboxEnabled && sandboxProvider === "remote" ? (
            <div className="mt-4 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-subtle)] p-3">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Remote sandbox</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Compatible with CubeSandbox and E2B endpoints. Commands run in an isolated
                    filesystem without mounting the local workspace.
                  </p>
                </div>
                <Input
                  label="Sandbox URL"
                  type="url"
                  value={sandboxRemoteUrl}
                  onChange={(event) => setSandboxRemoteUrl(event.target.value)}
                  placeholder="https://sandbox.example.com"
                  disabled={savingSandboxRuntime}
                />
                <Input
                  label="API key"
                  type="password"
                  value={sandboxRemoteApiKey}
                  onChange={(event) => setSandboxRemoteApiKey(event.target.value)}
                  placeholder="Optional bearer token"
                  disabled={savingSandboxRuntime}
                  helperText="Stored with the gateway configuration and sent only to this endpoint."
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    isLoading={savingSandboxRuntime}
                    onClick={() => void saveRemoteSandbox()}
                  >
                    Save remote sandbox
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="mt-4 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-subtle)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <Shield className="w-3.5 h-3.5 text-emerald-300" />
                  Sandbox Diagnostics
                </p>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Real-time provider checks. Docker/Podman must be installed locally to be used.
                </p>
              </div>
              {refreshingSandboxStatus && (
                <RefreshCw className="h-3 w-3 animate-spin text-[var(--text-subtle)]" />
              )}
            </div>
            {loadingSandboxStatus ? (
              <p className="mt-3 text-[11px] text-[var(--text-subtle)]">
                Checking sandbox runtime...
              </p>
            ) : sandboxStatus ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      !sandboxStatus.enabled
                        ? "default"
                        : sandboxStatus.available
                          ? "success"
                          : "error"
                    }
                  >
                    {!sandboxStatus.enabled
                      ? "Disabled"
                      : sandboxStatus.available
                        ? "Ready"
                        : "Unavailable"}
                  </Badge>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Configured:{" "}
                    <span className="text-[var(--text-primary)]">
                      {providerLabel(sandboxStatus.configuredProvider)}
                    </span>
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Resolved:{" "}
                    <span className="text-[var(--text-primary)]">
                      {providerLabel(sandboxStatus.resolvedProvider)}
                    </span>
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Network:{" "}
                    <span className="text-[var(--text-primary)]">
                      {sandboxStatus.network === "allow" ? "Allow" : "Deny"}
                    </span>
                  </span>
                </div>
                {sandboxStatus.reason && (
                  <div className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1 inline-flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5" />
                    <span>{sandboxStatus.reason}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                  {sandboxStatus.providers.map((entry) => (
                    <div
                      key={entry.provider}
                      className="rounded border border-[var(--surface-border)] px-2 py-1.5"
                    >
                      <p className="text-[11px] text-[var(--text-primary)]">
                        {providerLabel(entry.provider)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                        {entry.available
                          ? "Available"
                          : entry.reason || (!entry.installed ? "Not installed" : "Unavailable")}
                      </p>
                    </div>
                  ))}
                </div>
                {sandboxStatus.lastEvent && (
                  <div className="pt-1">
                    <p className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
                      Last sandbox event
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      {providerLabel(sandboxStatus.lastEvent.provider)} ·{" "}
                      {sandboxStatus.lastEvent.phase} ·{" "}
                      {new Date(sandboxStatus.lastEvent.timestamp).toLocaleTimeString()}
                    </p>
                    {sandboxStatus.lastEvent.commandPreview && (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-subtle)]">
                        {sandboxStatus.lastEvent.commandPreview}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-[var(--text-subtle)]">
                Sandbox diagnostics unavailable.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
