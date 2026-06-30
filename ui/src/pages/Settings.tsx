import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageLayout } from '@/components/layout';
import { useHealth, useInfo, useSystemPrompt, useSystemPromptPreview, useUpdateSystemPrompt, useIdentity, useUpdateIdentity, type SystemPromptConfig, type IdentityConfig, type HealthData, type InfoData } from '@/hooks/useApi';
import { settingsApi } from '@/lib/api';
import { openExternal } from '@/utils/openExternal';
import {
  checkForDesktopUpdate,
  describeDesktopUpdaterError,
  installDesktopUpdate,
  relaunchDesktopApp,
} from '@/lib/desktopUpdater';
import {
  getDesktopHostRuntime,
  getDesktopRuntimeLabel,
  isDesktopUpdaterSupported,
} from '@/lib/desktopHost';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  readThemeAccentFromConfig,
  themeAccentKeys,
  themeAccents,
  themeConfigPayload,
  useUIStore,
  type ThemeAccent,
} from '@/stores/uiStore';
import {
  Activity,
  AlertTriangle,
  Server,
  Database,
  Clock,
  CheckCircle,
  Bot,
  Cloud,
  HardDrive,
  Brain,
  User,
  Save,
  Sparkles,
  Eye,
  Palette,
  RefreshCw,
  Shield,
  Download,
  ExternalLink,
  MonitorUp,
} from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { Update, DownloadEvent } from '@tauri-apps/plugin-updater';

function getCheckStatus(value: unknown): { status: 'healthy' | 'warning' | 'error'; details?: string } {
  if (typeof value === 'string') {
    return { status: value === 'healthy' ? 'healthy' : 'error' };
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (obj.status === 'healthy') return { status: 'healthy' };
    if (obj.status) return { status: obj.status as 'error' };
    if ('total' in obj) {
      const running = obj.running !== undefined ? `, ${obj.running} running` : '';
      return { status: 'healthy', details: `${obj.total} total${running}` };
    }
    if ('heapUsed' in obj) {
      return { status: 'healthy', details: `${obj.heapUsed}MB / ${obj.heapTotal}MB` };
    }
  }
  return { status: 'healthy' };
}

function ThemeSettings() {
  const { accent, setAccent, addToast } = useUIStore();
  const [savingAccent, setSavingAccent] = useState<ThemeAccent | null>(null);

  const accentColors: Record<ThemeAccent, string> = {
    indigo: 'bg-indigo-500',
    blue: 'bg-blue-500',
    cyan: 'bg-cyan-500',
    teal: 'bg-teal-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    orange: 'bg-orange-500',
    rose: 'bg-rose-500',
    pink: 'bg-pink-500',
    purple: 'bg-purple-500',
  };

  useEffect(() => {
    let mounted = true;
    const loadGatewayTheme = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        const configAccent = readThemeAccentFromConfig(result.data);
        if (configAccent) setAccent(configAccent);
      } catch {
        // Keep the locally persisted accent if the gateway is unavailable.
      }
    };
    void loadGatewayTheme();
    return () => {
      mounted = false;
    };
  }, [setAccent]);

  const updateAccent = async (key: ThemeAccent) => {
    if (savingAccent || key === accent) return;
    const previous = accent;
    setAccent(key);
    setSavingAccent(key);
    try {
      const result = await settingsApi.updateConfig(themeConfigPayload(key));
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || 'Config update failed');
      }
      addToast('success', `Theme changed to ${themeAccents[key].name}`);
    } catch {
      setAccent(previous);
      addToast('error', 'Failed to update theme');
    } finally {
      setSavingAccent(null);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-indigo-400" />
          Theme Settings
        </CardTitle>
        <CardDescription>Customize the UI accent color</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {themeAccentKeys.map((key) => (
            <button
              key={key}
              aria-pressed={accent === key}
              disabled={savingAccent !== null}
              onClick={() => void updateAccent(key)}
              className={cn(
                'w-12 h-12 rounded-xl transition-all cursor-pointer',
                accentColors[key],
                accent === key
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0f] scale-110'
                  : 'hover:scale-105 opacity-70 hover:opacity-100',
                savingAccent !== null && 'cursor-not-allowed'
              )}
              title={themeAccents[key].name}
            />
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">Selected: {themeAccents[accent].name}</p>
      </CardContent>
    </Card>
  );
}

function DesktopUpdateSettings({
  currentVersion,
  releaseRepositoryUrl,
}: {
  currentVersion: string;
  releaseRepositoryUrl?: string;
}) {
  const { addToast } = useUIStore();
  const desktopRuntime = getDesktopHostRuntime();
  const isDesktopRuntime = desktopRuntime !== null;
  const supportsUpdater = isDesktopUpdaterSupported();
  const runtimeLabel = getDesktopRuntimeLabel(desktopRuntime);
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'current' | 'available' | 'installing' | 'error'
  >('idle');
  const [statusMessage, setStatusMessage] = useState(
    'Check for signed Cybara desktop updates published to GitHub Releases.'
  );
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const checkedOnMountRef = useRef(false);

  const handleCheck = useCallback(
    async (silent = false) => {
      if (!isDesktopRuntime) return;
      if (!supportsUpdater) {
        setStatus('current');
        setAvailableUpdate(null);
        setLastCheckedAt(new Date().toISOString());
        setStatusMessage(
          'This native Cybara macOS app uses the same local gateway on http://127.0.0.1:4269, but in-app signed updater installs are not wired for this host yet. Use GitHub Releases or rebuild from source.'
        );
        return;
      }

      setStatus('checking');
      setDownloadedBytes(0);
      setTotalBytes(null);
      if (!silent) {
        setStatusMessage('Checking GitHub Releases for a newer desktop build...');
      }

      try {
        const update = await checkForDesktopUpdate();
        setLastCheckedAt(new Date().toISOString());

        if (update) {
          setAvailableUpdate(update);
          setStatus('available');
          setStatusMessage(`Version ${update.version} is available to install.`);
          if (!silent) {
          addToast('success', `Desktop update ${update.version} is ready to install`);
          }
          return;
        }

        setAvailableUpdate(null);
        setStatus('current');
        setStatusMessage('This desktop build is already on the latest published release.');
        if (!silent) {
          addToast('success', 'Cybara desktop is already up to date');
        }
      } catch (error) {
        const message = describeDesktopUpdaterError(error);
        setAvailableUpdate(null);
        setStatus('error');
        setStatusMessage(message);
        if (!silent) {
          addToast('error', message);
        }
      }
    },
    [addToast, isDesktopRuntime, supportsUpdater]
  );

  const handleInstall = useCallback(async () => {
    if (!availableUpdate) return;

    setStatus('installing');
    setDownloadedBytes(0);
    setTotalBytes(null);
    setStatusMessage(`Downloading and installing ${availableUpdate.version}...`);

    try {
      await installDesktopUpdate(availableUpdate, (event: DownloadEvent) => {
        if (event.event === 'Started') {
          setDownloadedBytes(0);
          setTotalBytes(event.data.contentLength || null);
          return;
        }
        if (event.event === 'Progress') {
          setDownloadedBytes((previous) => previous + event.data.chunkLength);
          return;
        }
        if (event.event === 'Finished') {
          setStatusMessage(`Installed ${availableUpdate.version}. Restarting Cybara...`);
        }
      });
      addToast('success', `Installed ${availableUpdate.version}. Restarting Cybara...`);
      await relaunchDesktopApp();
    } catch (error) {
      const message = describeDesktopUpdaterError(error);
      setStatus('available');
      setStatusMessage(message);
      addToast('error', message);
    }
  }, [addToast, availableUpdate]);

  useEffect(() => {
    if (!isDesktopRuntime || checkedOnMountRef.current) return;
    checkedOnMountRef.current = true;
    void handleCheck(true);
  }, [handleCheck, isDesktopRuntime]);

  if (!isDesktopRuntime) {
    return null;
  }

  const releasesUrl = releaseRepositoryUrl ? `${releaseRepositoryUrl}/releases` : null;
  const updateBodyPreview = availableUpdate?.body?.trim()
    ? availableUpdate.body.trim().slice(0, 280)
    : null;
  const progressLabel =
    status === 'installing'
      ? totalBytes && totalBytes > 0
        ? `${formatByteCount(downloadedBytes)} / ${formatByteCount(totalBytes)}`
        : `${formatByteCount(downloadedBytes)} downloaded`
      : null;
  const statusVariant =
    status === 'available'
      ? 'warning'
      : status === 'current'
        ? 'success'
        : status === 'error'
          ? 'error'
          : 'default';
  const statusLabel =
    status === 'available'
      ? 'Update Available'
      : status === 'current'
        ? 'Up To Date'
        : status === 'installing'
          ? 'Installing'
          : status === 'error'
            ? 'Unavailable'
            : status === 'checking'
              ? 'Checking'
              : 'Idle';

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorUp className="w-5 h-5 text-emerald-400" />
          Desktop Updates
        </CardTitle>
        <CardDescription>
          {supportsUpdater
            ? `Signed updates for the ${runtimeLabel}`
            : `${runtimeLabel} runtime attached to the local Cybara gateway`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          <Badge variant="info">{runtimeLabel}</Badge>
          <span className="text-xs text-gray-400">
            Current version: <span className="text-white">{currentVersion || 'unknown'}</span>
          </span>
          {availableUpdate && (
            <span className="text-xs text-emerald-300">
              Latest: {availableUpdate.version}
            </span>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-sm text-white">{statusMessage}</p>
          {progressLabel && <p className="mt-1 text-xs text-emerald-300">{progressLabel}</p>}
          {lastCheckedAt && (
            <p className="mt-1 text-[11px] text-gray-500">
              Last checked {new Date(lastCheckedAt).toLocaleString()}
            </p>
          )}
          {updateBodyPreview && (
            <p className="mt-2 text-xs text-gray-300 whitespace-pre-wrap break-words">
              {updateBodyPreview}
              {availableUpdate?.body && availableUpdate.body.trim().length > updateBodyPreview.length
                ? '...'
                : ''}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void handleCheck()}
            disabled={status === 'checking' || status === 'installing' || !supportsUpdater}
          >
            <RefreshCw className={`w-4 h-4 ${status === 'checking' ? 'animate-spin' : ''}`} />
            {supportsUpdater ? 'Check Now' : 'Built From Source'}
          </Button>
          {availableUpdate && supportsUpdater && (
            <Button
              variant="primary"
              onClick={() => void handleInstall()}
              disabled={status === 'installing'}
            >
              <Download className="w-4 h-4" />
              Install And Restart
            </Button>
          )}
          {releasesUrl && (
            <Button
              variant="ghost"
              onClick={() => void openExternal(releasesUrl)}
              disabled={status === 'installing'}
            >
              <ExternalLink className="w-4 h-4" />
              View Releases
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type SandboxProviderOption = 'auto' | 'apple_sandbox' | 'podman' | 'docker';

interface SandboxStatusView {
  enabled: boolean;
  configuredProvider: SandboxProviderOption;
  network: 'allow' | 'deny';
  resolvedProvider: 'apple_sandbox' | 'podman' | 'docker' | null;
  available: boolean;
  reason?: string;
  providers: Array<{
    provider: 'apple_sandbox' | 'podman' | 'docker';
    supported: boolean;
    installed: boolean;
    available: boolean;
    reason?: string;
  }>;
  checkedAt: string;
  lastEvent: {
    phase: 'prepared' | 'disabled' | 'error';
    provider: 'apple_sandbox' | 'podman' | 'docker' | 'host' | null;
    commandPreview?: string;
    cwd?: string;
    network?: 'allow' | 'deny';
    reason?: string;
    timestamp: string;
  } | null;
}

function FeatureSettings() {
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [dangerousToolPolicyEnabled, setDangerousToolPolicyEnabled] = useState(false);
  const [dangerousToolPolicyMode, setDangerousToolPolicyMode] = useState<'audit' | 'block'>('audit');
  const [toolApprovalMode, setToolApprovalMode] = useState<'always_allow' | 'ask'>('always_allow');
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [sandboxProvider, setSandboxProvider] = useState<SandboxProviderOption>('auto');
  const [sandboxNetwork, setSandboxNetwork] = useState<'allow' | 'deny'>('deny');
  const [savingToolApprovalMode, setSavingToolApprovalMode] = useState(false);
  const [savingDangerousPolicy, setSavingDangerousPolicy] = useState(false);
  const [savingSandboxRuntime, setSavingSandboxRuntime] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSandboxStatus, setLoadingSandboxStatus] = useState(true);
  const [refreshingSandboxStatus, setRefreshingSandboxStatus] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatusView | null>(null);
  const { addToast } = useUIStore();

  const providerLabel = (provider: SandboxProviderOption | 'host' | null): string => {
    if (provider === 'apple_sandbox') return 'Apple Sandbox';
    if (provider === 'podman') return 'Podman';
    if (provider === 'docker') return 'Docker';
    if (provider === 'host') return 'Host';
    if (provider === 'auto') return 'Auto Detect';
    return 'None';
  };

  const refreshSandboxStatus = useCallback(async (silent = false): Promise<SandboxStatusView | null> => {
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
      // Ignore status refresh errors.
      return null;
    } finally {
      setLoadingSandboxStatus(false);
      if (!silent) setRefreshingSandboxStatus(false);
    }
  }, []);

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
        const policy = data?.dangerous_tool_policy as
          | { enabled?: boolean; mode?: string }
          | undefined;
        const modeRaw = typeof data?.tool_approval_mode === 'string' ? data.tool_approval_mode : '';
        const sandboxRaw = data?.sandbox_runtime as
          | { enabled?: boolean; provider?: string; network?: string }
          | undefined;
        setDangerousToolPolicyEnabled(policy?.enabled === true);
        setDangerousToolPolicyMode(policy?.mode === 'block' ? 'block' : 'audit');
        setToolApprovalMode(modeRaw === 'ask' ? 'ask' : 'always_allow');
        setSandboxEnabled(sandboxRaw?.enabled === true);
        setSandboxProvider(
          sandboxRaw?.provider === 'apple_sandbox' ||
            sandboxRaw?.provider === 'podman' ||
            sandboxRaw?.provider === 'docker'
            ? sandboxRaw.provider
            : 'auto'
        );
        setSandboxNetwork(sandboxRaw?.network === 'allow' ? 'allow' : 'deny');
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
        throw new Error(result.error || 'Config update failed');
      }
      addToast('success', `Web terminal ${enabled ? 'enabled' : 'disabled'}`);
    } catch {
      addToast('error', 'Failed to update terminal setting');
      setTerminalEnabled(!enabled);
    }
  };

  const updateDangerousPolicy = async (next: { enabled: boolean; mode: 'audit' | 'block' }) => {
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
        throw new Error(result.error || 'Config update failed');
      }
      addToast(
        'success',
        `Dangerous tool policy ${next.enabled ? `${next.mode} mode` : 'disabled'}`
      );
    } catch {
      setDangerousToolPolicyEnabled(previous.enabled);
      setDangerousToolPolicyMode(previous.mode);
      addToast('error', 'Failed to update dangerous tool policy');
    } finally {
      setSavingDangerousPolicy(false);
    }
  };

  const updateToolApprovalMode = async (nextMode: 'always_allow' | 'ask') => {
    const previousMode = toolApprovalMode;
    setToolApprovalMode(nextMode);
    setSavingToolApprovalMode(true);
    try {
      const result = await settingsApi.updateConfig({ tool_approval_mode: nextMode });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || 'Config update failed');
      }
      addToast(
        'success',
        nextMode === 'ask'
          ? 'Tool approvals set to Ask Me'
          : 'Tool approvals set to Always Allow'
      );
    } catch {
      setToolApprovalMode(previousMode);
      addToast('error', 'Failed to update tool approval mode');
    } finally {
      setSavingToolApprovalMode(false);
    }
  };

  const updateSandboxRuntime = async (next: {
    enabled: boolean;
    provider: SandboxProviderOption;
    network: 'allow' | 'deny';
  }) => {
    const previous = {
      enabled: sandboxEnabled,
      provider: sandboxProvider,
      network: sandboxNetwork,
    };

    setSandboxEnabled(next.enabled);
    setSandboxProvider(next.provider);
    setSandboxNetwork(next.network);
    setSavingSandboxRuntime(true);
    try {
      const result = await settingsApi.updateConfig({ sandbox_runtime: next });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || 'Config update failed');
      }
      const refreshedStatus = await refreshSandboxStatus(true);
      if (next.enabled && refreshedStatus && !refreshedStatus.available) {
        addToast(
          'error',
          `Sandbox unavailable: ${refreshedStatus.reason || 'No compatible provider on this machine'}`
        );
      } else {
        addToast('success', next.enabled ? 'Sandbox runtime enabled' : 'Sandbox runtime disabled');
      }
    } catch {
      setSandboxEnabled(previous.enabled);
      setSandboxProvider(previous.provider);
      setSandboxNetwork(previous.network);
      addToast('error', 'Failed to update sandbox runtime');
    } finally {
      setSavingSandboxRuntime(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          Features
        </CardTitle>
        <CardDescription>Enable or disable platform features</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between py-3 border-b border-white/10">
          <div>
            <p className="text-sm text-white font-medium">Web Terminal</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Enable browser-based terminal access. Also available via <code className="text-indigo-400">--enable-terminal</code> flag.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={terminalEnabled}
            disabled={loading}
            onClick={() => toggleTerminal(!terminalEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${terminalEnabled ? 'bg-indigo-500' : 'bg-white/10'
              } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${terminalEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
            />
          </button>
        </div>

        <div className="py-3 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">Dangerous Tool Policy</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Guardrails for high-impact tools like shell execution, wallet signing, and external actions.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={dangerousToolPolicyEnabled}
              disabled={loading || savingDangerousPolicy}
              onClick={() =>
                updateDangerousPolicy({
                  enabled: !dangerousToolPolicyEnabled,
                  mode: dangerousToolPolicyMode,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${dangerousToolPolicyEnabled ? 'bg-amber-500' : 'bg-white/10'
                } ${(loading || savingDangerousPolicy) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${dangerousToolPolicyEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
              />
            </button>
          </div>
          {dangerousToolPolicyEnabled && (
            <div className="mt-3 max-w-xs">
              <label className="block text-xs text-gray-400 mb-1">Mode</label>
              <Select
                value={dangerousToolPolicyMode}
                onChange={(value) =>
                  updateDangerousPolicy({
                    enabled: true,
                    mode: value === 'block' ? 'block' : 'audit',
                  })
                }
                options={[
                  { value: 'audit', label: 'Audit (log only)' },
                  { value: 'block', label: 'Block dangerous tools' },
                ]}
              />
            </div>
          )}
        </div>

        <div className="py-3 border-b border-white/10">
          <p className="text-sm text-white font-medium">Tool Approvals</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Choose how dangerous tools are handled across chat, Telegram, Discord, Slack, Signal, iMessage, and WhatsApp.
          </p>
          <div className="mt-3 max-w-xs">
            <Select
              value={toolApprovalMode}
              onChange={(value) =>
                void updateToolApprovalMode(value === 'ask' ? 'ask' : 'always_allow')
              }
              options={[
                { value: 'always_allow', label: 'Always Allow' },
                { value: 'ask', label: 'Ask Me First' },
              ]}
              disabled={loading || savingToolApprovalMode}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Channel shortcut: <code className="text-indigo-400">/permissions ask</code> or{' '}
            <code className="text-indigo-400">/permissions allow</code>
          </p>
        </div>

        <div className="py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">Command Sandbox</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Isolate `exec` and `git` tools with host/container sandboxing.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sandboxEnabled}
              disabled={loading || savingSandboxRuntime}
              onClick={() =>
                updateSandboxRuntime({
                  enabled: !sandboxEnabled,
                  provider: sandboxProvider,
                  network: sandboxNetwork,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                sandboxEnabled ? 'bg-emerald-500' : 'bg-white/10'
              } ${(loading || savingSandboxRuntime) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  sandboxEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {sandboxEnabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Provider</label>
                <Select
                  value={sandboxProvider}
                  onChange={(value) =>
                    updateSandboxRuntime({
                      enabled: true,
                      provider:
                        value === 'apple_sandbox' || value === 'podman' || value === 'docker'
                          ? value
                          : 'auto',
                      network: sandboxNetwork,
                    })
                  }
                  options={[
                    { value: 'auto', label: 'Auto Detect' },
                    { value: 'apple_sandbox', label: 'Apple Sandbox' },
                    { value: 'podman', label: 'Podman' },
                    { value: 'docker', label: 'Docker' },
                  ]}
                  disabled={savingSandboxRuntime}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Network</label>
                <Select
                  value={sandboxNetwork}
                  onChange={(value) =>
                    updateSandboxRuntime({
                      enabled: true,
                      provider: sandboxProvider,
                      network: value === 'allow' ? 'allow' : 'deny',
                    })
                  }
                  options={[
                    { value: 'deny', label: 'Deny Network' },
                    { value: 'allow', label: 'Allow Network' },
                  ]}
                  disabled={savingSandboxRuntime}
                />
              </div>
            </div>
          )}
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-white flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-emerald-300" />
                  Sandbox Diagnostics
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Real-time provider checks. Docker/Podman must be installed locally to be used.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshSandboxStatus()}
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-white/10 hover:bg-white/5 ${
                  refreshingSandboxStatus ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                }`}
                disabled={refreshingSandboxStatus}
              >
                <RefreshCw className={`w-3 h-3 ${refreshingSandboxStatus ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
            {loadingSandboxStatus ? (
              <p className="text-[11px] text-gray-500 mt-3">Checking sandbox runtime...</p>
            ) : sandboxStatus ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      !sandboxStatus.enabled
                        ? 'default'
                        : sandboxStatus.available
                          ? 'success'
                          : 'error'
                    }
                  >
                    {!sandboxStatus.enabled
                      ? 'Disabled'
                      : sandboxStatus.available
                        ? 'Ready'
                        : 'Unavailable'}
                  </Badge>
                  <span className="text-[11px] text-gray-400">
                    Configured: <span className="text-white">{providerLabel(sandboxStatus.configuredProvider)}</span>
                  </span>
                  <span className="text-[11px] text-gray-400">
                    Resolved: <span className="text-white">{providerLabel(sandboxStatus.resolvedProvider)}</span>
                  </span>
                  <span className="text-[11px] text-gray-400">
                    Network: <span className="text-white">{sandboxStatus.network === 'allow' ? 'Allow' : 'Deny'}</span>
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
                    <div key={entry.provider} className="rounded border border-white/10 px-2 py-1.5">
                      <p className="text-[11px] text-white">{providerLabel(entry.provider)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {entry.available
                          ? 'Available'
                          : entry.reason || (!entry.installed ? 'Not installed' : 'Unavailable')}
                      </p>
                    </div>
                  ))}
                </div>
                {sandboxStatus.lastEvent && (
                  <div className="pt-1">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Last sandbox event</p>
                    <p className="text-[11px] text-gray-300 mt-0.5">
                      {providerLabel(sandboxStatus.lastEvent.provider)} · {sandboxStatus.lastEvent.phase} ·{' '}
                      {new Date(sandboxStatus.lastEvent.timestamp).toLocaleTimeString()}
                    </p>
                    {sandboxStatus.lastEvent.commandPreview && (
                      <p className="text-[10px] text-gray-500 mt-0.5 font-mono truncate">
                        {sandboxStatus.lastEvent.commandPreview}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-gray-500 mt-3">Sandbox diagnostics unavailable.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Settings() {
  const { data: health } = useHealth();
  const { data: info } = useInfo();

  const healthData = (health || {}) as HealthData;
  const infoData = (info || {}) as InfoData;

  const stats = [
    {
      label: 'System Status',
      value: healthData.status || 'Unknown',
      icon: Activity,
      color: healthData.status === 'healthy' ? 'text-emerald-400' : 'text-red-400'
    },
    {
      label: 'Uptime',
      value: formatUptime(Number(healthData.uptime) || 0),
      icon: Clock,
      color: 'text-blue-400'
    },
    {
      label: 'Version',
      value: String(infoData.version || 'unknown'),
      icon: CheckCircle,
      color: 'text-amber-400'
    },
  ];

  const checks = healthData.checks
    ? Object.entries(healthData.checks as Record<string, unknown>).filter(([key]) => key !== 'memory')
    : [];

  return (
    <PageLayout title="Settings" subtitle="Platform configuration and system information">
      <div className="space-y-6">
        <ThemeSettings />

        <FeatureSettings />

        <DesktopUpdateSettings
          currentVersion={String(infoData.version || 'unknown')}
          releaseRepositoryUrl={infoData.releaseRepositoryUrl}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label} variant="liquid">
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center bg-white/5', stat.color)}>
                    <stat.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">{stat.label}</p>
                    <p className="text-xl font-semibold text-white capitalize">{stat.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card variant="liquid">
            <CardHeader>
              <CardTitle>System Information</CardTitle>
              <CardDescription>Platform details and version info</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between py-2 border-b border-white/10">
                <span className="text-gray-400">Platform Name</span>
                <span className="text-white">{infoData?.name || 'Cybara'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/10">
                <span className="text-gray-400">Version</span>
                <span className="text-white">{infoData?.version || 'unknown'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-white/10">
                <span className="text-gray-400">Setup Complete</span>
                <Badge variant={infoData?.setupComplete ? 'success' : 'warning'}>
                  {infoData?.setupComplete ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div className="flex justify-between py-2 border-b border-white/10">
                <span className="text-gray-400">Server Time</span>
                <span className="text-white">{healthData?.timestamp ? new Date(healthData.timestamp).toLocaleString() : 'N/A'}</span>
              </div>
            </CardContent>
          </Card>

          <Card variant="liquid">
            <CardHeader>
              <CardTitle>Health Checks</CardTitle>
              <CardDescription>Component status overview</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {checks.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Activity className="w-8 h-8 mx-auto mb-2" />
                  <p>No health checks available</p>
                </div>
              ) : (
                checks.map(([key, value]) => {
                  const check = getCheckStatus(value);
                  const icons: Record<string, React.ReactNode> = {
                    database: <Database className="w-5 h-5" />,
                    agents: <Bot className="w-5 h-5" />,
                    providers: <Cloud className="w-5 h-5" />,
                    memory: <HardDrive className="w-5 h-5" />,
                  };

                  return (
                    <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center',
                          check.status === 'healthy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        )}>
                          {icons[key] || <Server className="w-5 h-5" />}
                        </div>
                        <div>
                          <span className="text-white capitalize">{key}</span>
                          {check.details && (
                            <p className="text-xs text-gray-500">{check.details}</p>
                          )}
                        </div>
                      </div>
                      <Badge variant={check.status === 'healthy' ? 'success' : 'error'}>
                        {check.status}
                      </Badge>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <SystemPromptSection />
        </div>
      </div>
    </PageLayout>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatByteCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let amount = value;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

function SystemPromptSection() {
  const { data: systemPrompt, isLoading: loadingPrompt } = useSystemPrompt();
  const { data: identity, isLoading: loadingIdentity } = useIdentity();
  const updateSystemPrompt = useUpdateSystemPrompt();
  const updateIdentity = useUpdateIdentity();
  const { addToast } = useUIStore();

  const initialized = useRef(false);

  const [identityForm, setIdentityForm] = useState<Partial<IdentityConfig>>({
    name: '',
    emoji: '',
    creature: '',
    vibe: '',
    theme: 'dark',
  });

  const [customPrompt, setCustomPrompt] = useState('');
  const [features, setFeatures] = useState({
    memoryEnabled: true,
    skillsEnabled: true,
    messagingEnabled: true,
    replyTagsEnabled: true,
  });

  useEffect(() => {
    if (loadingPrompt || loadingIdentity) return;
    if (initialized.current) return;

    const typedSystemPrompt = systemPrompt as SystemPromptConfig | undefined;
    const typedIdentity = identity as IdentityConfig | undefined;

    if (typedIdentity) {
      setIdentityForm({
        name: typedIdentity.name || '',
        emoji: typedIdentity.emoji || '',
        creature: typedIdentity.creature || '',
        vibe: typedIdentity.vibe || '',
        theme: typedIdentity.theme || 'dark',
      });
    }

    if (typedSystemPrompt) {
      setCustomPrompt(typedSystemPrompt.customPrompt || '');
      setFeatures(typedSystemPrompt.features || {
        memoryEnabled: true,
        skillsEnabled: true,
        messagingEnabled: true,
        replyTagsEnabled: true,
      });
    }

    initialized.current = true;
  }, [systemPrompt, identity, loadingPrompt, loadingIdentity]);

  const handleSaveIdentity = async () => {
    try {
      await updateIdentity.mutateAsync(identityForm);
      addToast('success', 'Identity settings saved');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to save identity');
    }
  };

  const handleSaveSystemPrompt = async () => {
    try {
      await updateSystemPrompt.mutateAsync({
        customPrompt,
        features,
      });
      addToast('success', 'System prompt settings saved');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to save system prompt');
    }
  };

  const featureLabels: Record<string, { label: string; desc: string }> = {
    memoryEnabled: { label: 'Memory Recall', desc: 'Search memory before answering' },
    skillsEnabled: { label: 'Skills', desc: 'Read and use skill files' },
    messagingEnabled: { label: 'Messaging', desc: 'Multi-channel messaging' },
    replyTagsEnabled: { label: 'Reply Tags', desc: 'Special reply behaviors' },
  };

  const isLoading = loadingPrompt || loadingIdentity;

  return (
    <Card variant="liquid" className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-400" />
          System Prompt & Identity
        </CardTitle>
        <CardDescription>
          Customize how the AI assistant presents itself and behaves
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">
            <Sparkles className="w-8 h-8 mx-auto mb-2 animate-pulse" />
            <p>Loading configuration...</p>
          </div>
        ) : (
          <>
            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <User className="w-4 h-4 text-emerald-400" />
                AI Identity
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <Input
                    value={identityForm.name}
                    onChange={(e) => setIdentityForm({ ...identityForm, name: e.target.value })}
                    placeholder="Cybara"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Emoji</label>
                  <Input
                    value={identityForm.emoji}
                    onChange={(e) => setIdentityForm({ ...identityForm, emoji: e.target.value })}
                    placeholder="🧠"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Creature Type</label>
                  <Input
                    value={identityForm.creature}
                    onChange={(e) => setIdentityForm({ ...identityForm, creature: e.target.value })}
                    placeholder="AI assistant"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Vibe</label>
                  <Input
                    value={identityForm.vibe}
                    onChange={(e) => setIdentityForm({ ...identityForm, vibe: e.target.value })}
                    placeholder="Professional, helpful, and concise"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Theme</label>
                  <Select
                    value={identityForm.theme}
                    onChange={(value) => setIdentityForm({ ...identityForm, theme: value })}
                    options={[
                      { value: 'dark', label: 'Dark' },
                      { value: 'light', label: 'Light' },
                    ]}
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={handleSaveIdentity}
                  disabled={updateIdentity.isPending}
                  variant="primary"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateIdentity.isPending ? 'Saving...' : 'Save Identity'}
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Prompt Features
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {(Object.keys(features) as Array<keyof typeof features>).map((key) => (
                  <label key={key} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={features[key]}
                      onChange={(e) => setFeatures({ ...features, [key]: e.target.checked })}
                      className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-white block">{featureLabels[key]?.label}</span>
                      <span className="text-xs text-gray-500">{featureLabels[key]?.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white/5">
              <h4 className="flex items-center gap-2 text-white font-medium mb-4">
                <Bot className="w-4 h-4 text-blue-400" />
                Custom System Prompt
              </h4>
              <p className="text-sm text-gray-400 mb-3">
                This text is appended to the default system prompt. Use it to add custom instructions or override behaviors.
              </p>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="You are a helpful coding assistant that specializes in Rust..."
                rows={6}
                className="font-mono text-sm"
              />
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={handleSaveSystemPrompt}
                  disabled={updateSystemPrompt.isPending}
                  variant="primary"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateSystemPrompt.isPending ? 'Saving...' : 'Save System Prompt'}
                </Button>
              </div>
            </div>

            <SystemPromptPreviewSection />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SystemPromptPreviewSection() {
  const { data: preview, isLoading: loadingPreview } = useSystemPromptPreview();

  return (
    <div className="p-4 rounded-xl bg-white/5">
      <h4 className="flex items-center gap-2 text-white font-medium mb-4">
        <Eye className="w-4 h-4 text-cyan-400" />
        Current System Prompt Preview
      </h4>
      <p className="text-sm text-gray-400 mb-3">
        This is the current system prompt that will be sent to agents based on your configuration.
      </p>
      {loadingPreview ? (
        <div className="text-center py-4 text-gray-500">
          <Sparkles className="w-6 h-6 mx-auto mb-2 animate-pulse" />
          <p>Generating preview...</p>
        </div>
      ) : (
        <div className="bg-[#0a0a0f] rounded-xl p-4 max-h-96 overflow-y-auto">
          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">
            {preview?.preview || 'No preview available'}
          </pre>
        </div>
      )}
    </div>
  );
}
