import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageLayout } from '@/components/layout';
import { useHealth, useInfo, useSystemPrompt, useSystemPromptPreview, useUpdateSystemPrompt, useIdentity, useUpdateIdentity, type SystemPromptConfig, type IdentityConfig, type HealthData, type InfoData } from '@/hooks/useApi';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useUIStore, themeAccents, type ThemeAccent } from '@/stores/uiStore';
import {
  Activity,
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
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

// Helper to format check status
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

// Theme Settings Component
function ThemeSettings() {
  const { accent, setAccent, addToast } = useUIStore();

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
          {(Object.keys(themeAccents) as ThemeAccent[]).map((key) => (
            <button
              key={key}
              onClick={() => {
                setAccent(key);
                addToast('success', `Theme changed to ${themeAccents[key].name}`);
              }}
              className={cn(
                'w-12 h-12 rounded-xl transition-all cursor-pointer',
                accentColors[key],
                accent === key
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0f] scale-110'
                  : 'hover:scale-105 opacity-70 hover:opacity-100'
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

// Feature Toggles
function FeatureSettings() {
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const { addToast } = useUIStore();

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((data: Record<string, unknown>) => {
        setTerminalEnabled(data.terminal_enabled === true);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggleTerminal = async (enabled: boolean) => {
    setTerminalEnabled(enabled);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_enabled: enabled }),
      });
      addToast('success', `Web terminal ${enabled ? 'enabled' : 'disabled'}`);
    } catch {
      addToast('error', 'Failed to update terminal setting');
      setTerminalEnabled(!enabled);
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
      value: String(infoData.version || '1.0.0'),
      icon: CheckCircle,
      color: 'text-amber-400'
    },
  ];

  // Filter out 'memory' check to avoid confusion with stored memory files
  const checks = healthData.checks
    ? Object.entries(healthData.checks as Record<string, unknown>).filter(([key]) => key !== 'memory')
    : [];

  return (
    <PageLayout title="Settings" subtitle="Platform configuration and system information">
      <div className="space-y-6">
        {/* Theme Settings */}
        <ThemeSettings />

        {/* Feature Toggles */}
        <FeatureSettings />

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label} variant="liquid">
              <CardContent className="p-6">
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
                <span className="text-white">{infoData?.version || '1.0.0'}</span>
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

          {/* System Prompt Configuration */}
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

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

// System Prompt Configuration Section
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

  // Initialize form values when data loads
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
            {/* Identity Section */}
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

            {/* System Prompt Features */}
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

            {/* Custom System Prompt */}
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

            {/* System Prompt Preview */}
            <SystemPromptPreviewSection />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// System Prompt Preview Section
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
