import { classifyApiError } from "../error-classifier";

export class OpenAICodexStreamError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "OpenAICodexStreamError";
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function streamErrorRetryable(
  code: string | undefined,
  message: string,
  fallback: boolean
): boolean {
  const normalizedCode = code?.toLowerCase() || "";
  if (
    /invalid|authentication|authorization|permission|billing|quota|usage_limit|context_length/.test(
      normalizedCode
    )
  ) {
    return false;
  }
  if (/server|internal|rate|overload|timeout|connection|stream|unavailable/.test(normalizedCode)) {
    return true;
  }
  const classified = classifyApiError({ error: new Error(`${code || ""} ${message}`) });
  return classified.category === "unknown" ? fallback : classified.retryable;
}

export function openAICodexStreamEventError(
  event: Record<string, unknown>,
  fallbackMessage: string,
  retryUnknown: boolean
): OpenAICodexStreamError {
  const nested = objectValue(event.error);
  const response = objectValue(event.response);
  const responseError = objectValue(response?.error);
  const code =
    stringValue(event.code) || stringValue(nested?.code) || stringValue(responseError?.code);
  const detail =
    stringValue(event.message) ||
    stringValue(nested?.message) ||
    stringValue(responseError?.message) ||
    fallbackMessage;
  const message = code ? `${detail} (${code})` : detail;
  return new OpenAICodexStreamError(message, streamErrorRetryable(code, message, retryUnknown));
}

export function incompleteOpenAICodexStreamError(): OpenAICodexStreamError {
  return new OpenAICodexStreamError("OpenAI Codex stream ended before its completion marker", true);
}
