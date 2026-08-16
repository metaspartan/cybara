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

export function isDelegatedWaitStatusLabel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^waiting for \d+ delegated tasks?\.\.\.$/i.test(value.trim());
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
