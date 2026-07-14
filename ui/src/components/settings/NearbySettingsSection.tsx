import { useCallback, useEffect, useState } from "react";
import { Check, Laptop, Link2, Network, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { nearbyApi, type NearbySettings, type NearbyStatus } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";

const fallbackSettings: NearbySettings = {
  enabled: false,
  displayName: "Cybara",
  port: 4270,
  discoveryMinutes: 10,
};

export function NearbySettingsSection() {
  const { addToast } = useUIStore();
  const [status, setStatus] = useState<NearbyStatus | null>(null);
  const [settings, setSettings] = useState<NearbySettings>(fallbackSettings);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await nearbyApi.status();
    if (result.success && result.data) {
      setStatus(result.data);
      setSettings(result.data.settings);
      setLoadError(null);
    } else {
      setLoadError(
        /not found/i.test(result.error || "")
          ? "Nearby is unavailable in this gateway build. Rebuild or update the gateway, then restart it."
          : result.error || "Could not load Nearby Cybara"
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function save(next = settings) {
    setBusy("save");
    try {
      const result = await nearbyApi.updateSettings(next);
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Could not update Nearby Cybara");
      }
      setSettings(result.data.settings);
      setStatus(result.data.status);
      addToast("success", next.enabled ? "Nearby Cybara enabled" : "Nearby Cybara disabled");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Could not update Nearby Cybara");
    } finally {
      setBusy(null);
    }
  }

  async function action(key: string, run: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      const result = await run();
      if (result && typeof result === "object" && "success" in result && result.success === false) {
        const message =
          "error" in result && typeof result.error === "string"
            ? result.error
            : "Nearby action failed";
        throw new Error(message);
      }
      await load();
      addToast("success", success);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Nearby action failed");
    } finally {
      setBusy(null);
    }
  }

  const discoverable = Boolean(
    status?.discoverableUntil && Date.parse(status.discoverableUntil) > Date.now()
  );
  const pairedIds = new Set(status?.pairedPeers.map((peer) => peer.id) || []);

  return (
    <Card variant="liquid" className="overflow-hidden border border-[var(--surface-border)]">
      <CardHeader className="border-[var(--surface-border)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
              <Network className="h-5 w-5 text-[rgb(var(--accent-primary))]" />
              Nearby Cybara
            </CardTitle>
            <CardDescription className="text-[var(--text-muted)]">
              Pair trusted Cybara installations on your local network and send chats between them.
            </CardDescription>
          </div>
          <Switch
            checked={settings.enabled}
            disabled={loading || status === null || busy !== null}
            ariaLabel="Enable Nearby Cybara"
            onChange={(enabled) => {
              const next = { ...settings, enabled };
              setSettings(next);
              void save(next);
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadError ? (
          <div
            role="alert"
            className="rounded-lg border border-[rgba(var(--accent-primary),0.3)] bg-[rgba(var(--accent-primary),0.08)] px-3 py-2.5 text-sm text-[var(--text-secondary)]"
          >
            {loadError}
          </div>
        ) : null}
        <div className="flex items-start gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
          <p className="text-sm text-[var(--text-secondary)]">
            Off by default. Discovery is temporary, both devices must confirm the same code, and
            received chats require approval. Credentials, wallet data, and workspace paths are not
            shared.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Device name"
            value={settings.displayName}
            disabled={!settings.enabled || busy !== null}
            onChange={(event) => setSettings({ ...settings, displayName: event.target.value })}
          />
          <Input
            label="Peer port"
            type="number"
            min={1024}
            max={65535}
            value={settings.port}
            disabled={!settings.enabled || busy !== null}
            onChange={(event) => setSettings({ ...settings, port: Number(event.target.value) })}
          />
          <Input
            label="Discovery minutes"
            type="number"
            min={1}
            max={60}
            value={settings.discoveryMinutes}
            disabled={!settings.enabled || busy !== null}
            onChange={(event) =>
              setSettings({ ...settings, discoveryMinutes: Number(event.target.value) })
            }
          />
        </div>

        {settings.enabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void save()} isLoading={busy === "save"}>
              Save
            </Button>
            {discoverable ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void action("discover", () => nearbyApi.stopDiscoverable(), "Discovery stopped")
                }
                disabled={busy !== null}
              >
                <X className="h-4 w-4" /> Stop discovery
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  void action(
                    "discover",
                    () => nearbyApi.makeDiscoverable(),
                    "This Cybara is temporarily discoverable"
                  )
                }
                disabled={busy !== null}
              >
                <RefreshCw className="h-4 w-4" /> Find nearby
              </Button>
            )}
            <Badge variant={status?.running ? "success" : "default"}>
              {status?.running ? "Listening privately" : "Stopped"}
            </Badge>
          </div>
        ) : null}

        {settings.enabled && status?.discoveredPeers.length ? (
          <section className="space-y-2">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Available nearby</h4>
            {status.discoveredPeers
              .filter((peer) => !pairedIds.has(peer.id))
              .map((peer) => (
                <div
                  key={peer.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {peer.name}
                    </p>
                    <p className="truncate text-xs text-[var(--text-muted)]">{peer.baseUrl}</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void action(
                        `pair:${peer.id}`,
                        () => nearbyApi.pair(peer.id, peer.baseUrl),
                        "Verify the code on both devices"
                      )
                    }
                  >
                    <Link2 className="h-4 w-4" /> Connect
                  </Button>
                </div>
              ))}
          </section>
        ) : null}

        {status?.pairings.length ? (
          <section className="space-y-2">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Verify pairing</h4>
            {status.pairings.map((pairing) => (
              <div
                key={pairing.id}
                className="rounded-lg border border-[rgba(var(--accent-primary),0.35)] bg-[rgba(var(--accent-primary),0.08)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {pairing.peerName}
                    </p>
                    <p className="mt-1 font-mono text-2xl tracking-[0.24em] text-[var(--text-primary)]">
                      {pairing.verificationCode}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Confirm only when this code matches the other device.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!pairing.localConfirmed ? (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          void action(
                            `confirm:${pairing.id}`,
                            () => nearbyApi.confirmPairing(pairing.id),
                            "Pairing confirmed"
                          )
                        }
                      >
                        <Check className="h-4 w-4" /> Codes match
                      </Button>
                    ) : (
                      <Badge variant="success">Confirmed here</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void action(
                          `reject:${pairing.id}`,
                          () => nearbyApi.rejectPairing(pairing.id),
                          "Pairing dismissed"
                        )
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {status?.pairedPeers.length ? (
          <section className="space-y-2">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Paired devices</h4>
            {status.pairedPeers.map((peer) => (
              <div
                key={peer.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Laptop className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {peer.name}
                    </p>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      Verified {peer.fingerprint.slice(0, 12)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Remove paired device"
                  disabled={busy !== null}
                  onClick={() =>
                    void action(
                      `remove:${peer.id}`,
                      () => nearbyApi.removePeer(peer.id),
                      "Paired device removed"
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </section>
        ) : null}

        {status?.incomingTransfers.length ? (
          <section className="space-y-2">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Received chats</h4>
            {status.incomingTransfers.map((transfer) => (
              <div
                key={transfer.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {transfer.title || "Shared chat"}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    From {transfer.peerName} · {transfer.messageCount} messages
                    {transfer.workspace ? ` · ${transfer.workspace.name}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void action(
                        `accept:${transfer.id}`,
                        () => nearbyApi.acceptTransfer(transfer.id),
                        "Chat imported without a workspace"
                      )
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void action(
                        `dismiss:${transfer.id}`,
                        () => nearbyApi.dismissTransfer(transfer.id),
                        "Transfer dismissed"
                      )
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
