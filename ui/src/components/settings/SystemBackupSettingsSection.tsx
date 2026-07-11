import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, DatabaseBackup, FolderOpen, RotateCcw, Trash2 } from "lucide-react";
import { systemApi, type SystemBackupSummary, type SystemRestoreStatus } from "@/lib/api";
import { formatByteCount } from "@/lib/settingsFormat";
import { useUIStore } from "@/stores/uiStore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type PendingAction =
  | { kind: "restore"; backup: SystemBackupSummary }
  | { kind: "delete"; backup: SystemBackupSummary }
  | null;

function formatBackupDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function restoreBadgeVariant(
  status: SystemRestoreStatus["state"]
): "default" | "success" | "warning" | "error" {
  if (status === "completed") return "success";
  if (status === "pending") return "warning";
  if (status === "failed") return "error";
  return "default";
}

async function waitForGateway(timeoutMs = 45_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    try {
      const response = await systemApi.health();
      if (response.success) return true;
    } catch {}
  }
  return false;
}

export function SystemBackupSettingsSection() {
  const { addToast } = useUIStore();
  const [backups, setBackups] = useState<SystemBackupSummary[]>([]);
  const [backupDirectory, setBackupDirectory] = useState("");
  const [restoreStatus, setRestoreStatus] = useState<SystemRestoreStatus>({ state: "idle" });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadBackups = useCallback(async () => {
    const response = await systemApi.backups();
    if (!response.success || !response.data) {
      throw new Error(response.error || "Unable to load system backups");
    }
    setBackups(response.data.backups);
    setBackupDirectory(response.data.backupDirectory);
    setRestoreStatus(response.data.restore);
  }, []);

  useEffect(() => {
    void loadBackups()
      .catch((error) => {
        addToast("error", error instanceof Error ? error.message : "Unable to load backups");
      })
      .finally(() => setLoading(false));
  }, [addToast, loadBackups]);

  async function createBackup() {
    setCreating(true);
    try {
      const response = await systemApi.createBackup(`Manual backup ${new Date().toLocaleString()}`);
      if (!response.success || !response.data?.success) {
        throw new Error(response.error || "Backup creation failed");
      }
      addToast("success", "System backup created");
      await loadBackups();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Backup creation failed");
    } finally {
      setCreating(false);
    }
  }

  async function confirmAction() {
    if (!pendingAction) return;
    setActionBusy(true);
    try {
      if (pendingAction.kind === "delete") {
        const response = await systemApi.deleteBackup(pendingAction.backup.id);
        if (!response.success || !response.data?.success) {
          throw new Error(response.error || "Backup deletion failed");
        }
        addToast("success", "Backup deleted");
        setPendingAction(null);
        await loadBackups();
        return;
      }
      const response = await systemApi.restoreBackup(pendingAction.backup.id);
      if (!response.success || !response.data?.success) {
        throw new Error(response.error || "Backup restore could not be staged");
      }
      addToast("info", "Restoring backup and restarting the gateway…");
      const restart = await systemApi.restart();
      if (!restart.success) throw new Error(restart.error || "Gateway restart failed");
      setPendingAction(null);
      if (await waitForGateway()) {
        addToast("success", "Backup restored");
        window.location.reload();
      } else {
        addToast("error", "Gateway did not return within 45 seconds. Check gateway logs.");
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Backup action failed");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <>
      <Card variant="liquid">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <DatabaseBackup className="h-5 w-5 text-cyan-400" />
                Backup & Restore
              </CardTitle>
              <CardDescription>
                Local snapshots of gateway settings, conversations, memory, skills, and credentials
              </CardDescription>
            </div>
            <Button
              variant="secondary"
              leftIcon={<DatabaseBackup className="h-4 w-4" />}
              isLoading={creating}
              onClick={() => void createBackup()}
            >
              Create Backup
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
            <ArchiveRestore className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-xs leading-5 text-amber-100">
              Backups contain provider credentials and other private gateway data. They stay in the
              configured Cybara data directory with owner-only permissions. Restoring replaces
              durable state and restarts the gateway.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <FolderOpen className="h-4 w-4" />
            <span className="font-mono break-all">{backupDirectory || "Loading backup path…"}</span>
            {restoreStatus.state !== "idle" && (
              <Badge variant={restoreBadgeVariant(restoreStatus.state)}>
                Restore {restoreStatus.state}
              </Badge>
            )}
          </div>

          {restoreStatus.state === "failed" && restoreStatus.error && (
            <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200">
              {restoreStatus.error}
            </p>
          )}

          <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">Loading backups…</div>
            ) : backups.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                No backups yet. Create one before upgrades or major configuration changes.
              </div>
            ) : (
              backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{backup.label}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatBackupDate(backup.createdAt)} · {formatByteCount(backup.bytes)} ·{" "}
                      {backup.entries.length} data groups
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<RotateCcw className="h-4 w-4" />}
                      onClick={() => setPendingAction({ kind: "restore", backup })}
                    >
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${backup.label}`}
                      onClick={() => setPendingAction({ kind: "delete", backup })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        isOpen={pendingAction !== null}
        onClose={() => !actionBusy && setPendingAction(null)}
        onConfirm={() => void confirmAction()}
        title={pendingAction?.kind === "restore" ? "Restore System Backup" : "Delete Backup"}
        description={
          pendingAction?.kind === "restore"
            ? "This replaces durable gateway data with the selected snapshot and restarts Cybara. Current logs and caches are preserved."
            : "This permanently removes the selected local backup."
        }
        confirmText={pendingAction?.kind === "restore" ? "Restore & Restart" : "Delete"}
        variant={pendingAction?.kind === "restore" ? "warning" : "danger"}
        isLoading={actionBusy}
      />
    </>
  );
}
