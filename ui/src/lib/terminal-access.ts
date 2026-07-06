import { apiFetch } from "@/lib/auth";

export type TerminalAccessState =
  { enabled: true; error?: undefined } | { enabled: false; error: string };

function errorTextFromPayload(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  const message = record.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  return null;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body.trim()) return fallback;
  try {
    return errorTextFromPayload(JSON.parse(body)) || body.trim();
  } catch {
    return body.trim();
  }
}

export async function checkTerminalAccess(): Promise<TerminalAccessState> {
  try {
    const response = await apiFetch("/api/terminal/sessions");
    if (response.ok) return { enabled: true };
    if (response.status === 403) {
      return {
        enabled: false,
        error: await readApiError(response, "Terminal access is disabled."),
      };
    }
    return {
      enabled: false,
      error: await readApiError(response, `Terminal API unavailable (${response.status}).`),
    };
  } catch (error) {
    return {
      enabled: false,
      error: error instanceof Error ? error.message : "Terminal API unavailable.",
    };
  }
}

export async function enableTerminalAccess(): Promise<void> {
  const response = await apiFetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ terminal_enabled: true }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to enable terminal access."));
  }

  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (record.success === false) {
      throw new Error(errorTextFromPayload(record) || "Failed to enable terminal access.");
    }
  }
}
