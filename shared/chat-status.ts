const PROVIDER_RECOVERY_PREFIXES = [
  "provider connection interrupted; retrying",
  "provider rate limited; retrying",
  "provider temporarily unavailable; retrying",
  "provider session refreshed; continuing",
];

export function isProviderRecoveryStatusLabel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return PROVIDER_RECOVERY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function formatDelegatedRunWaitLabel(count: number): string {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
  return `Running ${safeCount} ${safeCount === 1 ? "task" : "tasks"}…`;
}

export function delegatedRunWaitCount(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const legacy = /^waiting for (\d+) delegated tasks?\.\.\.$/i.exec(value.trim());
  if (legacy?.[1]) return Number.parseInt(legacy[1], 10);
  const current = /^running (\d+) tasks?…$/i.exec(value.trim());
  if (current?.[1]) return Number.parseInt(current[1], 10);
  return null;
}

export function isDelegatedWaitStatusLabel(value: unknown): boolean {
  return delegatedRunWaitCount(value) !== null;
}

export function isVisibleActivityText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !isProviderRecoveryStatusLabel(value)
  );
}

export function isGenericChatStatusLabel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    isProviderRecoveryStatusLabel(normalized) ||
    normalized === "thinking..." ||
    normalized === "thinking" ||
    normalized === "generating response..." ||
    normalized === "generating response" ||
    normalized === "idle" ||
    normalized === "working..." ||
    normalized === "working"
  );
}
