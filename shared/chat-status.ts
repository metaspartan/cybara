const PROVIDER_RECOVERY_PREFIXES = [
  "provider connection interrupted; retrying",
  "provider rate limited; retrying",
  "provider temporarily unavailable; retrying",
  "provider session refreshed; continuing",
];

export function isProviderRecoveryStatusLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return PROVIDER_RECOVERY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isGenericChatStatusLabel(value: string): boolean {
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
