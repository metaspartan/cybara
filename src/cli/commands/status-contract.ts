export interface StatusResponse {
  status: string;
  uptime: number;
  checks: Record<string, { status?: string; total?: number; running?: number }>;
  timestamp: string;
  system?: {
    cpu?: { usagePct?: number; loadPct?: number | null; cores?: number; model?: string };
    memory?: {
      totalBytes?: number;
      freeBytes?: number;
      usedBytes?: number;
      usedPct?: number;
      swap?: {
        totalBytes?: number;
        freeBytes?: number;
        usedBytes?: number;
        usedPct?: number;
      } | null;
    };
    process?: {
      pid?: number;
      cpuUsagePct?: number;
      memory?: { rssBytes?: number; heapUsedBytes?: number; heapTotalBytes?: number };
    };
    disk?: {
      path?: string;
      totalBytes?: number;
      freeBytes?: number;
      usedBytes?: number;
      usedPct?: number;
    } | null;
  };
}

export type DoctorSeverity = "pass" | "warn" | "fail";

export function classifyDoctorHealth(status: string | undefined): DoctorSeverity {
  if (status === "healthy") return "pass";
  if (status?.trim()) return "warn";
  return "fail";
}

export interface MetricsResponse {
  tokenUsage: { total: number; input: number; output: number; cache: number };
  fileOperations: { filesRead: number; filesWritten: number; filesEdited: number };
  toolCalls: { totalCalls: number };
  apiCalls: { totalCalls: number; successfulCalls: number; failedCalls: number };
  agentExecutions: { totalExecutions: number; totalMessages: number };
}

export function formatStatusUptime(sec: number): string {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatStatusBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

export function formatStatusStorageBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (value >= 1000 ** 3) return `${(value / 1000 ** 3).toFixed(2)} GB`;
  if (value >= 1000 ** 2) return `${(value / 1000 ** 2).toFixed(1)} MB`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

export function formatStatusPct(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}
