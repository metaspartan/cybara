import {
  Building2,
  Check,
  Cloud,
  ExternalLink,
  Link2,
  Mail,
  NotebookText,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import {
  type AccountConnectorAccess,
  type AccountConnectorId,
  type AccountConnectorStatus,
  accountConnectorsApi,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { openExternal } from "@/utils/openExternal";

interface ConnectorDraft {
  clientId: string;
  clientSecret: string;
  access: AccountConnectorAccess;
}

function emptyDraft(status: AccountConnectorStatus): ConnectorDraft {
  return { clientId: "", clientSecret: "", access: status.access };
}

async function waitForConnection(state: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    const response = await accountConnectorsApi.oauthStatus(state);
    if (response.data?.status === "connected") return;
    if (response.data?.status === "error") {
      throw new Error(response.data.error || "Account authorization failed");
    }
    if (response.data?.status === "not_found") {
      throw new Error("Account authorization expired");
    }
  }
  throw new Error("Account authorization timed out");
}

function ConnectorIcon({ id }: { id: AccountConnectorId }) {
  if (id === "google_workspace") return <Mail className="h-5 w-5" />;
  if (id === "microsoft_365") return <Building2 className="h-5 w-5" />;
  if (id === "notion") return <NotebookText className="h-5 w-5" />;
  return <Cloud className="h-5 w-5" />;
}

export function AccountAppsPanel() {
  const { addToast } = useUIStore();
  const [connectors, setConnectors] = useState<AccountConnectorStatus[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<AccountConnectorId, ConnectorDraft>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<AccountConnectorId | null>(null);

  const load = async (): Promise<void> => {
    const response = await accountConnectorsApi.list();
    if (!response.success || !response.data) {
      throw new Error(response.error || "Failed to load account connectors");
    }
    setConnectors(response.data);
    setDrafts((current) => {
      const next = { ...current };
      for (const status of response.data || []) {
        next[status.id] = {
          ...(next[status.id] ?? emptyDraft(status)),
          access: status.access,
        };
      }
      return next;
    });
  };

  useEffect(() => {
    void load()
      .catch((error) =>
        addToast("error", error instanceof Error ? error.message : "Failed to load connectors")
      )
      .finally(() => setLoading(false));
  }, []);

  const patchDraft = (id: AccountConnectorId, patch: Partial<ConnectorDraft>): void => {
    const status = connectors.find((item) => item.id === id);
    if (!status) return;
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || emptyDraft(status)), ...patch },
    }));
  };

  const save = async (status: AccountConnectorStatus): Promise<void> => {
    const draft = drafts[status.id] || emptyDraft(status);
    const response = await accountConnectorsApi.update(status.id, {
      ...(draft.clientId ? { clientId: draft.clientId } : {}),
      ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
      access: draft.access,
    });
    if (!response.success) throw new Error(response.error || "Failed to save connector");
  };

  const connect = async (status: AccountConnectorStatus): Promise<void> => {
    setBusy(status.id);
    try {
      await save(status);
      const response = await accountConnectorsApi.startOAuth(status.id);
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to start account authorization");
      }
      await openExternal(response.data.authUrl);
      addToast("info", `Complete ${status.label} authorization in your browser`);
      await waitForConnection(response.data.state);
      await load();
      addToast("success", `${status.label} connected`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Connection failed");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (status: AccountConnectorStatus): Promise<void> => {
    setBusy(status.id);
    try {
      const response = await accountConnectorsApi.disconnect(status.id);
      if (!response.success) throw new Error(response.error || "Failed to disconnect account");
      await load();
      addToast("success", `${status.label} disconnected`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[rgb(var(--accent-primary))]" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">Private by default</p>
          <p className="mt-0.5 text-sm text-gray-400">
            Credentials stay encrypted on this gateway. Reading is the default; account changes
            remain approval-gated.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-label="Loading account connectors">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-[28rem] animate-pulse rounded-lg border border-white/10 bg-[var(--surface-panel,#11131c)]"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {connectors.map((status) => {
            const draft = drafts[status.id] || emptyDraft(status);
            const isBusy = busy === status.id;
            return (
              <section
                key={status.id}
                className="overflow-hidden rounded-lg border border-white/10 bg-[var(--surface-panel,#11131c)]"
              >
                <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]">
                      <ConnectorIcon id={status.id} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-white">{status.label}</h2>
                        <Badge variant={status.connected ? "success" : "default"}>
                          {status.connected ? "Connected" : "Not connected"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-gray-400">{status.description}</p>
                    </div>
                  </div>
                  {status.connected ? (
                    <Check className="h-5 w-5 shrink-0 text-emerald-400" />
                  ) : null}
                </div>

                <div className="space-y-4 p-4">
                  {status.account ? (
                    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
                      <p className="text-xs text-gray-500">Connected account</p>
                      <p className="mt-0.5 truncate text-sm text-gray-200">{status.account}</p>
                    </div>
                  ) : null}

                  <Input
                    label={status.clientIdLabel}
                    value={draft.clientId}
                    placeholder={status.configured ? "Configured" : "Paste the client identifier"}
                    onChange={(event) => patchDraft(status.id, { clientId: event.target.value })}
                    autoComplete="off"
                  />
                  {status.clientSecretLabel ? (
                    <Input
                      type="password"
                      label={status.clientSecretLabel}
                      value={draft.clientSecret}
                      placeholder={status.configured ? "Configured" : "Paste the client secret"}
                      onChange={(event) =>
                        patchDraft(status.id, {
                          clientSecret: event.target.value,
                        })
                      }
                      autoComplete="new-password"
                    />
                  ) : null}

                  <div className="rounded-lg bg-white/[0.04] px-3 py-2">
                    <p className="text-xs text-gray-500">OAuth callback URL</p>
                    <p className="mt-0.5 break-all font-mono text-xs text-gray-300">
                      {status.redirectUri}
                    </p>
                  </div>

                  <Switch
                    checked={draft.access === "read_write"}
                    onChange={(enabled) =>
                      patchDraft(status.id, {
                        access: enabled ? "read_write" : "read",
                      })
                    }
                    label="Allow account changes"
                    description="Sending messages, uploading files, creating events, and creating pages still require agent approval. Changing access reconnects the account."
                  />

                  {status.needsReauthorization ? (
                    <p className="text-sm text-amber-400">
                      Reconnect to apply the selected access.
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      isLoading={isBusy}
                      leftIcon={<Link2 className="h-4 w-4" />}
                      onClick={() => void connect(status)}
                    >
                      {status.connected ? "Reconnect" : "Connect"}
                    </Button>
                    {status.connected ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        leftIcon={<Unplug className="h-4 w-4" />}
                        onClick={() => void disconnect(status)}
                      >
                        Disconnect
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<ExternalLink className="h-4 w-4" />}
                      onClick={() => void openExternal(status.docsUrl)}
                    >
                      Setup
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
