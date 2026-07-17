import { apiFetch } from "./auth";

export interface GatewayAccessCheck {
  message: string;
  status: "ready" | "required" | "unavailable";
}

export type GatewayAccessFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

function responseErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error.trim() : null;
}

export async function checkGatewayAccess(
  fetcher: GatewayAccessFetcher = apiFetch
): Promise<GatewayAccessCheck> {
  try {
    const response = await fetcher("/api/info", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.ok) return { message: "", status: "ready" };
    const body = await response.json().catch(() => null);
    const message = responseErrorMessage(body);
    if (response.status === 401 || response.status === 403) {
      return {
        message: message || "Authentication is required",
        status: "required",
      };
    }
    return {
      message: message || `Gateway returned HTTP ${response.status}`,
      status: "unavailable",
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Gateway is unavailable",
      status: "unavailable",
    };
  }
}
