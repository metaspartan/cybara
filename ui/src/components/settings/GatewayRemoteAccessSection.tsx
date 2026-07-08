import { useEffect, useMemo, useState } from "react";
import { Cloud, Globe2, Lock, Network, ShieldCheck } from "lucide-react";
import { authApi, type GatewayAuthSettings, type GatewayRemoteAccessSettings } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";

type Mode = GatewayRemoteAccessSettings["mode"];
type Provider = GatewayRemoteAccessSettings["provider"];

const modeOptions: Array<{ value: Mode; label: string }> = [
  { value: "private_overlay", label: "Private mesh: Tailscale, ZeroTier, NetBird" },
  { value: "public_tunnel", label: "Public HTTPS tunnel or custom domain" },
];

const providerOptions: Array<{ value: Provider; label: string }> = [
  { value: "tailscale", label: "Tailscale" },
  { value: "zerotier", label: "ZeroTier" },
  { value: "netbird", label: "NetBird" },
  { value: "cloudflare", label: "Cloudflare Tunnel" },
  { value: "custom", label: "Custom reverse proxy" },
];

function statusBadge(status?: GatewayRemoteAccessSettings["status"]) {
  if (status === "ready") return <Badge variant="success">Ready</Badge>;
  if (status === "off") return <Badge>Off</Badge>;
  if (status === "needs_password" || status === "needs_https" || status === "invalid_url") {
    return <Badge variant="warning">Needs attention</Badge>;
  }
  return <Badge variant="info">Setup needed</Badge>;
}

export function GatewayRemoteAccessSection({
  disabled,
  onUpdated,
  settings,
}: {
  disabled: boolean;
  onUpdated: (settings: GatewayAuthSettings) => void;
  settings: GatewayAuthSettings | null;
}) {
  const { addToast } = useUIStore();
  const remote = settings?.remoteAccess;
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<Mode>("private_overlay");
  const [provider, setProvider] = useState<Provider>("tailscale");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(remote?.enabled === true);
    setMode(remote?.mode || "private_overlay");
    setProvider(remote?.provider || "tailscale");
    setBaseUrl(remote?.baseUrl || "");
  }, [remote?.baseUrl, remote?.enabled, remote?.mode, remote?.provider]);

  const example = useMemo(() => {
    const port = settings?.port || settings?.configuredPort || 4269;
    if (provider === "cloudflare") {
      return `cloudflared tunnel --url http://127.0.0.1:${port}`;
    }
    if (provider === "tailscale" && mode === "public_tunnel") {
      return `tailscale funnel --bg ${port}`;
    }
    if (provider === "tailscale") {
      return `tailscale serve --bg http://127.0.0.1:${port}`;
    }
    if (provider === "zerotier")
      return `Use the gateway's ZeroTier IP, for example http://10.x.x.x:${port}`;
    if (provider === "netbird")
      return `Use the gateway's NetBird peer IP or DNS name on port ${port}`;
    return `Point HTTPS at http://127.0.0.1:${port}`;
  }, [mode, provider, settings?.configuredPort, settings?.port]);

  async function save() {
    setSaving(true);
    try {
      const res = await authApi.updateSettings({
        remoteAccess: {
          enabled,
          mode,
          provider,
          baseUrl: baseUrl.trim(),
        },
      });
      if (!res.success || !res.data?.success) {
        throw new Error(res.error || "Failed to update remote access");
      }
      onUpdated(res.data);
      addToast("success", "Remote access settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update remote access");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-cyan-400" />
            <p className="text-sm font-medium text-gray-200">Remote access domain</p>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Use a private mesh for the safest mobile access away from home. Public domains must use
            HTTPS and the gateway password.
          </p>
        </div>
        {statusBadge(remote?.status)}
      </div>

      <div className="space-y-3">
        <Switch
          label="Enable remote access URL"
          description="Adds this URL as an allowed mobile pairing target without changing the gateway bind host."
          checked={enabled}
          disabled={disabled || saving}
          onChange={setEnabled}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Access method"
            value={mode}
            disabled={disabled || saving}
            options={modeOptions}
            onChange={(value) => setMode(value as Mode)}
          />
          <Select
            label="Provider"
            value={provider}
            disabled={disabled || saving}
            options={providerOptions}
            onChange={(value) => setProvider(value as Provider)}
          />
        </div>
        <Input
          label="Client URL"
          value={baseUrl}
          disabled={disabled || saving}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={
            mode === "public_tunnel" ? "https://cybara.example.com" : "https://name.tailnet.ts.net"
          }
          helperText="This exact URL is embedded in mobile QR codes when remote access is ready."
        />
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
            {mode === "public_tunnel" ? (
              <Cloud className="h-3.5 w-3.5 text-cyan-400" />
            ) : (
              <Network className="h-3.5 w-3.5 text-cyan-400" />
            )}
            Setup hint
          </div>
          <code className="mt-2 block overflow-x-auto font-mono text-[11px] text-gray-400">
            {example}
          </code>
          <div className="mt-3 grid gap-2 text-xs text-gray-500 md:grid-cols-2">
            <div className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>Keep API keys private. Mobile devices still receive scoped tokens only.</span>
            </div>
            <div className="flex gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>For public tunnels, enable the gateway password before creating QRs.</span>
            </div>
          </div>
        </div>
        {remote?.message ? (
          <p className={`text-xs ${remote.ready ? "text-emerald-300" : "text-amber-300"}`}>
            {remote.message}
          </p>
        ) : null}
        <Button variant="secondary" onClick={() => void save()} disabled={disabled || saving}>
          {saving ? "Saving…" : "Save Remote Access"}
        </Button>
      </div>
    </div>
  );
}
