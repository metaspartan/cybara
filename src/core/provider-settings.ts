export interface DevinProviderSettings {
  organizationId: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

const DEVIN_DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEVIN_DEFAULT_TIMEOUT_MS = 1_800_000;

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function readOrganizationId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(normalized)) return "";
  return normalized;
}

export function normalizeProviderSettings(
  providerType: string,
  value: unknown
): Record<string, unknown> | undefined {
  if (providerType !== "devin") return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const organizationId = readOrganizationId(
    input.organizationId ?? input.organization_id ?? input.orgId ?? input.org_id
  );
  if (!organizationId) return undefined;
  return {
    organizationId,
    pollIntervalMs: boundedInteger(
      input.pollIntervalMs ?? input.poll_interval_ms,
      DEVIN_DEFAULT_POLL_INTERVAL_MS,
      500,
      30_000
    ),
    timeoutMs: boundedInteger(
      input.timeoutMs ?? input.timeout_ms,
      DEVIN_DEFAULT_TIMEOUT_MS,
      10_000,
      7_200_000
    ),
  } satisfies DevinProviderSettings;
}

export function readDevinProviderSettings(value: unknown): DevinProviderSettings | undefined {
  const normalized = normalizeProviderSettings("devin", value);
  if (!normalized) return undefined;
  return normalized as unknown as DevinProviderSettings;
}
