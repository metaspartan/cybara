import { getFlagValue, hasFlag } from "./args";

export interface BackupSummary {
  id: string;
  label: string;
  createdAt: string;
  entries: string[];
  bytes: number;
}

interface RestoreStatus {
  state: "idle" | "pending" | "completed" | "failed";
  backupId?: string;
  error?: string;
}

export interface BackupsResponse {
  backups: BackupSummary[];
  backupDirectory: string;
  restore: RestoreStatus;
}

export interface BackupMutationResponse {
  success?: boolean;
  backup?: BackupSummary;
  restartRequired?: boolean;
  error?: string;
  message?: string;
}

export type BackupFetch = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function requireBackupId(args: string[], action: string): string {
  const id = args.find((value, index) => index > 0 && !value.startsWith("-"));
  if (!id) throw new Error(`Usage: cybara backup ${action} <backup-id> --yes`);
  return id;
}

async function requireResponse<T>(
  fetchAPI: BackupFetch,
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetchAPI<T>(endpoint, options);
  if (!response) throw new Error("Gateway did not return a backup response");
  return response;
}

function printBackups(response: BackupsResponse): void {
  console.log("System Backups");
  console.log("==============");
  console.log(`Directory: ${response.backupDirectory}`);
  if (response.restore.state !== "idle") {
    console.log(
      `Restore:   ${response.restore.state}${response.restore.error ? ` (${response.restore.error})` : ""}`
    );
  }
  console.log("");
  if (response.backups.length === 0) {
    console.log("No backups found.");
    return;
  }
  for (const backup of response.backups) {
    console.log(`${backup.id}  ${formatBytes(backup.bytes)}  ${formatDate(backup.createdAt)}`);
    console.log(`  ${backup.label}`);
  }
}

export async function runSystemBackupCommand(args: string[], fetchAPI: BackupFetch): Promise<void> {
  const action = args[0] || "list";
  if (action === "list") {
    printBackups(await requireResponse<BackupsResponse>(fetchAPI, "/api/system/backups"));
    return;
  }
  if (action === "create") {
    const label =
      getFlagValue(args.slice(1), "--label") || `Manual backup ${new Date().toLocaleString()}`;
    const response = await requireResponse<BackupMutationResponse>(
      fetchAPI,
      "/api/system/backups",
      {
        method: "POST",
        body: JSON.stringify({ label }),
      }
    );
    if (!response.success || !response.backup)
      throw new Error(response.error || "Backup creation failed");
    console.log(`Created ${response.backup.id} (${formatBytes(response.backup.bytes)})`);
    return;
  }
  if (action === "restore") {
    const id = requireBackupId(args, "restore");
    if (!hasFlag(args, "--yes", "-y")) {
      throw new Error(
        `Restore replaces durable gateway data. Re-run with: cybara backup restore ${id} --yes`
      );
    }
    const response = await requireResponse<BackupMutationResponse>(
      fetchAPI,
      `/api/system/backups/${encodeURIComponent(id)}/restore`,
      { method: "POST" }
    );
    if (!response.success) throw new Error(response.error || "Backup restore could not be staged");
    const restart = await requireResponse<BackupMutationResponse>(fetchAPI, "/api/system/restart", {
      method: "POST",
    });
    if (restart.success === false) throw new Error(restart.error || "Gateway restart failed");
    console.log(`Restore scheduled for ${id}. ${restart.message || "Gateway restarting."}`);
    return;
  }
  if (action === "delete" || action === "remove") {
    const id = requireBackupId(args, "delete");
    if (!hasFlag(args, "--yes", "-y")) {
      throw new Error(`Re-run with: cybara backup delete ${id} --yes`);
    }
    const response = await requireResponse<BackupMutationResponse>(
      fetchAPI,
      `/api/system/backups/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    if (!response.success) throw new Error(response.error || "Backup deletion failed");
    console.log(`Deleted ${id}`);
    return;
  }
  throw new Error("Usage: cybara backup <list|create|restore|delete>");
}
