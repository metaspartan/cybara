import { useMemo, useState } from "react";
import {
  Copy,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  XCircle,
} from "lucide-react";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useCreateMobileDevice,
  useDeleteMobileDevice,
  useMobileDevices,
  useRevokeMobileDevice,
} from "@/hooks/useApi";
import { getGatewayBasePath } from "@/lib/auth";
import { useUIStore } from "@/stores/uiStore";
import type { MobileDevice, MobilePairing } from "@/types";

function defaultGatewayUrl(): string {
  if (typeof window === "undefined") return "http://localhost:4269";
  return `${window.location.origin}${getGatewayBasePath()}`;
}

function formatDate(value?: string): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function Mobile() {
  const { addToast } = useUIStore();
  const { data, isLoading, refetch, isFetching } = useMobileDevices();
  const createMobileDevice = useCreateMobileDevice();
  const revokeMobileDevice = useRevokeMobileDevice();
  const deleteMobileDevice = useDeleteMobileDevice();
  const [deviceName, setDeviceName] = useState("My iPhone");
  const [gatewayName, setGatewayName] = useState("Cybara Gateway");
  const [baseUrl, setBaseUrl] = useState(defaultGatewayUrl);
  const [pairing, setPairing] = useState<MobilePairing | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<MobileDevice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MobileDevice | null>(null);

  const devices = useMemo(() => data?.devices || [], [data?.devices]);
  const activeCount = devices.filter((device) => device.status === "active").length;

  const createPairing = async () => {
    try {
      const result = await createMobileDevice.mutateAsync({
        deviceName,
        gatewayName,
        baseUrl,
      });
      setPairing(result);
      addToast("success", `Mobile pairing ready for ${result.device.name}`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to create mobile pairing");
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast("success", `${label} copied`);
    } catch {
      addToast("error", `Could not copy ${label.toLowerCase()}`);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeMobileDevice.mutateAsync(revokeTarget.id);
      addToast("success", `Revoked ${revokeTarget.name}`);
      setRevokeTarget(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to revoke device");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMobileDevice.mutateAsync(deleteTarget.id);
      addToast("success", `Removed ${deleteTarget.name}`);
      setDeleteTarget(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to remove device");
    }
  };

  return (
    <PageLayout
      title="Mobile"
      subtitle="Pair and manage Cybara Mobile devices"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-cyan-400" />
                Pair Mobile App
              </CardTitle>
              <CardDescription>
                Create a revocable device token and scan it from Cybara Mobile.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Device name"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                placeholder="Carsen iPhone"
              />
              <Input
                label="Gateway name"
                value={gatewayName}
                onChange={(event) => setGatewayName(event.target.value)}
                placeholder="Studio Gateway"
              />
              <Input
                label="Gateway URL"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://192.168.1.20:4269"
                helperText="Use a LAN-reachable URL when pairing from a phone."
              />
              <Button
                className="w-full"
                leftIcon={<Plus className="w-4 h-4" />}
                isLoading={createMobileDevice.isPending}
                onClick={createPairing}
              >
                Create QR Pairing
              </Button>
            </CardContent>
          </Card>

          {pairing ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Ready To Scan
                </CardTitle>
                <CardDescription>{pairing.device.name} has a managed mobile token.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white p-4">
                  <img
                    src={pairing.qrDataUrl}
                    alt="Cybara Mobile pairing QR"
                    className="mx-auto h-64 w-64"
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="mb-2 text-xs font-medium uppercase text-gray-500">Device ID</p>
                  <p className="break-all font-mono text-xs text-gray-300">{pairing.device.id}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    leftIcon={<Copy className="w-4 h-4" />}
                    onClick={() => void copyText(pairing.encoded, "Pairing payload")}
                  >
                    Copy Payload
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    leftIcon={<Copy className="w-4 h-4" />}
                    onClick={() =>
                      void copyText(
                        `cybara://connect?name=${encodeURIComponent(pairing.payload.name)}&baseUrl=${encodeURIComponent(pairing.payload.baseUrl)}&apiKey=${encodeURIComponent(pairing.payload.apiKey)}&deviceId=${encodeURIComponent(pairing.payload.deviceId)}`,
                        "Deep link"
                      )
                    }
                  >
                    Copy Link
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-indigo-400" />
              Paired Devices
            </CardTitle>
            <CardDescription>
              {activeCount} active, {devices.length} total mobile device records.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-sm text-gray-400">
                Loading mobile devices...
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
                <Smartphone className="mx-auto mb-3 h-8 w-8 text-gray-500" />
                <p className="text-sm text-gray-300">No mobile devices are paired yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {devices.map((device) => (
                  <div
                    key={device.id}
                    className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">{device.name}</p>
                        <Badge variant={device.status === "active" ? "success" : "warning"}>
                          {device.status}
                        </Badge>
                      </div>
                      <p className="break-all font-mono text-xs text-gray-500">{device.id}</p>
                      <div className="grid gap-1 text-xs text-gray-400 sm:grid-cols-2">
                        <span>Gateway: {device.baseUrl}</span>
                        <span>Created: {formatDate(device.createdAt)}</span>
                        <span>Last seen: {formatDate(device.lastSeenAt)}</span>
                        <span>Revoked: {formatDate(device.revokedAt)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 md:justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={device.status !== "active"}
                        leftIcon={<XCircle className="w-4 h-4" />}
                        onClick={() => setRevokeTarget(device)}
                      >
                        Revoke
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        leftIcon={<Trash2 className="w-4 h-4" />}
                        onClick={() => setDeleteTarget(device)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        isOpen={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={confirmRevoke}
        title="Revoke Mobile Access"
        description={`Revoke ${revokeTarget?.name || "this device"} so its app token can no longer access this gateway.`}
        confirmText="Revoke"
        isLoading={revokeMobileDevice.isPending}
        variant="warning"
      />
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Remove Mobile Device"
        description={`Remove ${deleteTarget?.name || "this device"} from the trust list. Active devices should be revoked before removal.`}
        confirmText="Remove"
        isLoading={deleteMobileDevice.isPending}
      />
    </PageLayout>
  );
}
