import { apiFetch } from "@/lib/auth";
import type { ApiResponse } from "@/types";

const API_BASE = "/api";

export function extractApiError<T>(response: ApiResponse<T>, fallback: string): string {
  const data = response.data as { error?: unknown } | undefined;
  const dataError =
    data && typeof data === "object" && typeof data.error === "string" ? data.error : null;
  return dataError || response.error || fallback;
}

export async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${endpoint}`;
  const response = await apiFetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error };
  }

  const data = await response.json();
  return { success: true, data };
}
