import { useEffect, useMemo, useState } from "react";
import { Cloud, Copy, Globe2, Lock, Network, ShieldAlert, ShieldCheck, Wifi } from "lucide-react";
import { authApi, type GatewayAuthSettings, type GatewayRemoteAccessSettings } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";

type Mode = GatewayRemoteAccessSettings["mode"];
type Provider = GatewayRemoteAccessSettings["provider"];
type Status = GatewayRemoteAccessSettings["status"];

interface Choice {
  value: Mode;
  title: string;
  label: string;
  description: string;
  icon: typeof Network;
}

interface ProviderChoice {
  value: Provider;
  title: string;
  description: string;
  modes: Mode[];
}

const modeChoices: Choice[] = [
  {
    value: "private_overlay",
    title: "Private mesh",
    label: "Recommended",
    description: "Use Tailscale, ZeroTier, or NetBird so Cybara is never public.",
    icon: Network,
  },
  {
    value: "public_tunnel",
    title: "Public HTTPS",
    label: "Guarded",
    description: "Use a tunnel or custom domain only with HTTPS and a gateway password.",
    icon: Globe2,
  },
];

const providerChoices: ProviderChoice[] = [
  {
    value: "tailscale",
    title: "Tailscale",
    description: "Tailnet HTTPS or Funnel when public access is intentional.",
    modes: ["private_overlay", "public_tunnel"],
  },
  {
    value: "zerotier",
    title: "ZeroTier",
    description: "Private virtual network IP for phones joined to the same network.",
    modes: ["private_overlay"],
  },
  {
    value: "netbird",
    title: "NetBird",
    description: "Private peer IP or DNS inside your NetBird network.",
    modes: ["private_overlay"],
  },
  {
    value: "cloudflare",
    title: "Cloudflare Tunnel",
    description: "HTTPS hostname proxied back to this local gateway.",
    modes: ["public_tunnel"],
  },
  {
    value: "custom",
    title: "Custom",
    description: "Your own reverse proxy, mesh DNS, or HTTPS hostname.",
    modes: ["private_overlay", "public_tunnel"],
  },
];

function statusBadge(status: Status) {
  if (status === "ready") return <Badge variant="success">Ready</Badge>;
  if (status === "off") return <Badge>Off</Badge>;
  return <Badge variant="warning">Needs setup</Badge>;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isPrivateHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4 = host.split(".").map((part) => Number(part));
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [a, b] = ipv4;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254)
    );
  }
  return host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal");
}

function previewStatus({
  baseUrl,
  enabled,
  gatewayPasswordEnabled,
  mode,
}: {
  baseUrl: string;
  enabled: boolean;
  gatewayPasswordEnabled: boolean;
  mode: Mode;
}): { status: Status; message: string } {
  if (!enabled) {
    return {
      status: "off",
      message:
        "Remote QR pairing stays off. LAN pairing still works when local network access is enabled.",
    };
  }
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return {
      status: "needs_url",
      message: "Add the URL phones should use before creating remote QR codes.",
    };
  }
  const parsed = parseUrl(trimmed);
  if (!parsed) {
    return {
      status: "invalid_url",
      message: "Enter a complete URL including http:// or https://.",
    };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.startsWith("127.")) {
    return { status: "invalid_url", message: "Remote QR codes cannot point phones at localhost." };
  }
  if (mode === "public_tunnel" && parsed.protocol !== "https:") {
    return {
      status: "needs_https",
      message: "Public tunnel and custom-domain access must use HTTPS.",
    };
  }
  if (mode === "private_overlay" && parsed.protocol === "http:" && !isPrivateHttpHost(host)) {
    return {
      status: "needs_https",
      message: "HTTP is only allowed for private mesh or LAN IPs. Use HTTPS for DNS names.",
    };
  }
  if (mode === "public_tunnel" && !gatewayPasswordEnabled) {
    return {
      status: "needs_password",
      message: "Enable the gateway password below before using a public tunnel or custom domain.",
    };
  }
  return {
    status: "ready",
    message:
      mode === "public_tunnel"
        ? "Ready after saving. Keep the hostname on HTTPS and leave the gateway password enabled."
        : "Ready after saving. Phones must still authenticate with scoped mobile tokens.",
  };
}

function setupHint(provider: Provider, mode: Mode, port: number): string {
  if (provider === "cloudflare") return `cloudflared tunnel --url http://127.0.0.1:${port}`;
  if (provider === "tailscale" && mode === "public_tunnel") return `tailscale funnel --bg ${port}`;
  if (provider === "tailscale") return `tailscale serve --bg http://127.0.0.1:${port}`;
  if (provider === "zerotier")
    return `Use the gateway's ZeroTier IP, for example http://10.x.x.x:${port}`;
  if (provider === "netbird")
    return `Use the gateway's NetBird peer IP or DNS name on port ${port}`;
  return `Terminate HTTPS at your proxy, then forward to http://127.0.0.1:${port}`;
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

  const compatibleProviders = useMemo(
    () => providerChoices.filter((choice) => choice.modes.includes(mode)),
    [mode]
  );

  const port = settings?.port || settings?.configuredPort || 4269;
  const example = useMemo(() => setupHint(provider, mode, port), [mode, port, provider]);
  const preview = useMemo(
    () =>
      previewStatus({
        baseUrl,
        enabled,
        gatewayPasswordEnabled: settings?.gatewayPasswordEnabled === true,
        mode,
      }),
    [baseUrl, enabled, mode, settings?.gatewayPasswordEnabled]
  );
  const selectedMode = modeChoices.find((choice) => choice.value === mode) ?? modeChoices[0];
  const ModeIcon = selectedMode.icon;

  function selectMode(next: Mode) {
    setMode(next);
    if (!providerChoices.find((choice) => choice.value === provider)?.modes.includes(next)) {
      setProvider(next === "public_tunnel" ? "cloudflare" : "tailscale");
    }
  }

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(example);
      addToast("success", "Setup command copied");
    } catch {
      addToast("error", "Could not copy setup command");
    }
  }

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
    <section className="overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.055] to-white/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-cyan-300" />
            <p className="text-sm font-semibold text-gray-100">Remote Mobile Access</p>
            {statusBadge(preview.status)}
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-400">
            Let phones connect outside local Wi-Fi without exposing Cybara directly. Private mesh is
            safest; public hostnames require HTTPS and the gateway password.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled || saving}
          onChange={setEnabled}
          label="Remote QR URLs"
          className="min-w-[210px] border-white/10 bg-black/20"
        />
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="grid gap-2 md:grid-cols-2">
          {modeChoices.map((choice) => {
            const Icon = choice.icon;
            const selected = choice.value === mode;
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={selected}
                disabled={disabled || saving}
                onClick={() => selectMode(choice.value)}
                className={cn(
                  "rounded-lg border px-3 py-3 text-left transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50",
                  selected
                    ? "border-cyan-300/35 bg-cyan-300/10"
                    : "border-white/10 bg-black/15 hover:border-white/20 hover:bg-white/[0.04]",
                  disabled || saving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-100">
                    <Icon className="h-4 w-4 text-cyan-300" />
                    {choice.title}
                  </span>
                  <Badge variant={choice.value === "private_overlay" ? "success" : "warning"}>
                    {choice.label}
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-400">{choice.description}</p>
              </button>
            );
          })}
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {compatibleProviders.map((choice) => {
            const selected = choice.value === provider;
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={selected}
                disabled={disabled || saving}
                onClick={() => setProvider(choice.value)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50",
                  selected
                    ? "border-amber-300/35 bg-amber-300/10"
                    : "border-white/10 bg-black/15 hover:border-white/20 hover:bg-white/[0.04]",
                  disabled || saving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                )}
              >
                <p className="text-sm font-medium text-gray-100">{choice.title}</p>
                <p className="mt-1 text-xs leading-4 text-gray-500">{choice.description}</p>
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1fr_0.9fr]">
          <Input
            label={mode === "public_tunnel" ? "HTTPS hostname" : "Mesh or private URL"}
            value={baseUrl}
            disabled={disabled || saving}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={
              mode === "public_tunnel"
                ? "https://cybara.example.com"
                : "https://name.tailnet.ts.net or http://100.64.x.x:4269"
            }
            helperText="This exact origin is embedded in mobile QR codes once the gateway accepts it."
          />

          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                {mode === "public_tunnel" ? (
                  <Cloud className="h-3.5 w-3.5 text-cyan-300" />
                ) : (
                  <Wifi className="h-3.5 w-3.5 text-cyan-300" />
                )}
                Setup hint
              </div>
              <button
                type="button"
                onClick={() => void copyExample()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-white/10 hover:text-gray-100"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
            <code className="mt-2 block overflow-x-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-300">
              {example}
            </code>
          </div>
        </div>

        <div
          className={cn(
            "flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5",
            preview.status === "ready"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
              : preview.status === "off"
                ? "border-white/10 bg-black/15 text-gray-400"
                : "border-amber-400/30 bg-amber-400/10 text-amber-100"
          )}
        >
          {preview.status === "ready" ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          ) : preview.status === "off" ? (
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          ) : (
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          )}
          <div>
            <p className="font-medium">{preview.message}</p>
            <p className="mt-1 text-[11px] opacity-80">
              The gateway bind address is unchanged. Paired phones receive scoped tokens, and public
              root/UI access still requires the gateway password.
            </p>
          </div>
        </div>

        {remote?.message && remote.message !== preview.message ? (
          <p className={`text-xs ${remote.ready ? "text-emerald-300" : "text-amber-300"}`}>
            Saved state: {remote.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Private mesh is the default recommendation for open-source users. Public tunnels should
            stay behind provider access controls when possible.
          </p>
          <Button
            variant="secondary"
            onClick={() => void save()}
            disabled={disabled || saving}
            isLoading={saving}
          >
            Save Remote Access
          </Button>
        </div>
      </div>
    </section>
  );
}
