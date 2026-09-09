import { randomUUID } from "crypto";

export const OPENCODE_SESSION_HEADER = "x-opencode-session";
export const OPENCODE_CLIENT_HEADER = "x-opencode-client";
const OPENCODE_CLIENT_NAME = "cybara";
const OPENCODE_PROVIDER_TYPES = new Set([
  "opencode",
  "opencode_zen",
  "opencode-go",
  "opencode-go-zen",
]);

function isOpenCodeBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "opencode.ai" || host.endsWith(".opencode.ai");
  } catch {
    return false;
  }
}

export function isOpenCodeProvider(providerType: string | undefined, baseUrl?: string): boolean {
  const normalized = (providerType || "").trim().toLowerCase();
  return OPENCODE_PROVIDER_TYPES.has(normalized) || isOpenCodeBaseUrl(baseUrl);
}

export function openCodeSessionHeaders(
  providerType: string | undefined,
  baseUrl: string | undefined,
  sessionId: string | undefined
): Record<string, string> {
  if (!isOpenCodeProvider(providerType, baseUrl)) return {};
  const trimmed = (sessionId || "").trim();
  return {
    [OPENCODE_SESSION_HEADER]: trimmed || randomUUID(),
    [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT_NAME,
  };
}
