export type DashboardHealthStatus = "healthy" | "warning" | "error";

export interface DashboardCheckStatus {
  status: DashboardHealthStatus;
  details?: string;
}

function normalizeStatus(value: string): DashboardHealthStatus {
  const status = value.trim().toLowerCase();
  if (status === "healthy" || status === "ok" || status === "passing")
    return "healthy";
  if (status === "warning" || status === "degraded") return "warning";
  return "error";
}

export function getDashboardCheckStatus(value: unknown): DashboardCheckStatus {
  if (typeof value === "string") return { status: normalizeStatus(value) };
  if (typeof value !== "object" || value === null) return { status: "error" };

  const record = value as Record<string, unknown>;
  if (typeof record.status === "string") {
    return { status: normalizeStatus(record.status) };
  }
  if (typeof record.total === "number" && Number.isFinite(record.total)) {
    return { status: "healthy", details: `${record.total} total` };
  }
  if (typeof record.heapUsed === "number" && Number.isFinite(record.heapUsed)) {
    return { status: "healthy", details: `${record.heapUsed}MB used` };
  }
  return { status: "error" };
}
