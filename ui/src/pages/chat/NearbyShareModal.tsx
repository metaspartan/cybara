import { Check, Laptop, Link2, Loader2, RefreshCw, Send, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { nearbyApi, type NearbyStatus } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";

export function NearbyShareModal({
  isOpen,
  onClose,
  sessionId,
}: {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
}) {
  const { addToast } = useUIStore();
  const [status, setStatus] = useState<NearbyStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pairAddress, setPairAddress] = useState("");

  const refresh = useCallback(async () => {
    const result = await nearbyApi.status();
    if (result.success && result.data) setStatus(result.data);
  }, []);

  const discover = useCallback(async () => {
    const result = await nearbyApi.refresh();
    if (result.success && result.data?.status) setStatus(result.data.status);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [isOpen, refresh]);

  const run = useCallback(
    async (
      key: string,
      action: () => Promise<{ success: boolean; error?: string }>,
      ok?: string
    ) => {
      setBusy(key);
      try {
        const result = await action();
        if (!result.success) throw new Error(result.error || "Nearby action failed");
        if (ok) addToast("success", ok);
        await refresh();
        return true;
      } catch (error) {
        addToast("error", error instanceof Error ? error.message : "Nearby action failed");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [addToast, refresh]
  );

  const send = useCallback(
    async (peerId: string) => {
      if (!sessionId) return;
      const done = await run(
        `send:${peerId}`,
        () => nearbyApi.sendSession(peerId, sessionId),
        status?.pairedPeers.find((peer) => peer.id === peerId)?.syncEnabled
          ? "Chat imported on the other device"
          : "Chat sent for approval on the other device"
      );
      if (done) onClose();
    },
    [run, sessionId, onClose, status]
  );

  const pairedIds = new Set(status?.pairedPeers.map((peer) => peer.id) ?? []);
  const availablePeers = (status?.discoveredPeers ?? []).filter((peer) => !pairedIds.has(peer.id));
  const pendingPairings = status?.pairings ?? [];
  const nearbyEnabled = status?.settings.enabled ?? false;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send to nearby Cybara" size="sm">
      {!nearbyEnabled ? (
        <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--text-secondary)]">
          Nearby is turned off. Enable it in Settings → Gateway → Nearby to pair and share chats.
        </div>
      ) : (
        <div className="space-y-4">
          {status?.pairedPeers.length ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Paired devices
              </h4>
              {status.pairedPeers.map((peer) => (
                <button
                  key={peer.id}
                  type="button"
                  disabled={busy !== null || !sessionId}
                  onClick={() => void send(peer.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-3 text-left transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Laptop className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                        {peer.name}
                      </span>
                      <span className="block truncate text-xs text-[var(--text-muted)]">
                        Verified {peer.fingerprint.slice(0, 12)}
                      </span>
                    </span>
                  </span>
                  {busy === `send:${peer.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
                  ) : (
                    <Send className="h-4 w-4 text-[rgb(var(--accent-primary))]" />
                  )}
                </button>
              ))}
            </section>
          ) : (
            <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3 text-sm text-[var(--text-secondary)]">
              No paired devices yet. Connect one below, then send this chat to it.
            </div>
          )}

          {pendingPairings.length ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Verify pairing
              </h4>
              {pendingPairings.map((pairing) => (
                <div
                  key={pairing.id}
                  className="rounded-lg border border-[rgba(var(--accent-primary),0.35)] bg-[rgba(var(--accent-primary),0.08)] p-3"
                >
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {pairing.peerName}
                  </p>
                  <p className="mt-1 font-mono text-2xl tracking-[0.24em] text-[var(--text-primary)]">
                    {pairing.verificationCode}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Confirm only if this code matches the other device.
                  </p>
                  <div className="mt-2 flex gap-2">
                    {!pairing.localConfirmed ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            `confirm:${pairing.id}`,
                            () =>
                              nearbyApi.confirmPairing(pairing.id).then(() => ({ success: true })),
                            "Pairing confirmed"
                          )
                        }
                      >
                        <Check className="h-4 w-4" /> Codes match
                      </Button>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">
                        Waiting for other device…
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`reject:${pairing.id}`, () => nearbyApi.rejectPairing(pairing.id))
                      }
                    >
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {status?.incomingTransfers.length ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Received chats
              </h4>
              {status.incomingTransfers.map((transfer) => (
                <div
                  key={transfer.id}
                  className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3"
                >
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {transfer.title || "Shared chat"}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    From {transfer.peerName} · {transfer.messageCount} messages
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          `accept:${transfer.id}`,
                          () => nearbyApi.acceptTransfer(transfer.id),
                          "Chat imported"
                        )
                      }
                    >
                      <Check className="h-4 w-4" /> Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(`dismiss:${transfer.id}`, () =>
                          nearbyApi.dismissTransfer(transfer.id)
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

          {availablePeers.length ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Available nearby
              </h4>
              {availablePeers.map((peer) => (
                <div
                  key={peer.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                      {peer.name}
                    </span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">
                      {peer.baseUrl}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        `pair:${peer.id}`,
                        () => nearbyApi.pair(peer.id, peer.baseUrl).then(() => ({ success: true })),
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

          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Connect by address
              </h4>
              <button
                type="button"
                onClick={() => void discover()}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title="Refresh nearby devices"
              >
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>
            <div className="flex gap-2">
              <Input
                aria-label="Nearby Cybara LAN address"
                placeholder="192.168.1.73:4270"
                value={pairAddress}
                disabled={busy !== null}
                onChange={(event) => setPairAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const value = pairAddress.trim();
                  if (!value) return;
                  const baseUrl = /^https?:\/\//i.test(value) ? value : `http://${value}`;
                  void run(
                    "pair-address",
                    () => nearbyApi.pairByAddress(baseUrl).then(() => ({ success: true })),
                    "Verify the code on both devices"
                  ).then((done) => {
                    if (done) setPairAddress("");
                  });
                }}
              />
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={!pairAddress.trim() || busy !== null}
                isLoading={busy === "pair-address"}
                onClick={() => {
                  const value = pairAddress.trim();
                  const baseUrl = /^https?:\/\//i.test(value) ? value : `http://${value}`;
                  void run(
                    "pair-address",
                    () => nearbyApi.pairByAddress(baseUrl).then(() => ({ success: true })),
                    "Verify the code on both devices"
                  ).then((done) => {
                    if (done) setPairAddress("");
                  });
                }}
              >
                <Link2 className="h-4 w-4" /> Connect
              </Button>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
