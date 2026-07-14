export function normalizeCredentialDestination(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function credentialDestinationChanged(
  previous: string | undefined,
  next: string | undefined
): boolean {
  return normalizeCredentialDestination(previous) !== normalizeCredentialDestination(next);
}
