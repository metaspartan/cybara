/**
 * Shared retry/backoff wrapper for provider HTTP calls (DRY).
 *
 * Previously each provider adapter (Anthropic, OpenAI-compat, Google, Bedrock)
 * implemented its own transient-error retry loop with duplicated backoff logic
 * and its own status-code sets. This module provides one configurable wrapper.
 *
 * It classifies failures via `classifyApiError`, retries transient categories
 * with capped exponential backoff + jitter, and optionally consults a credential
 * pool to rotate keys on rate-limit/auth failures.
 */
import { classifyApiError, type ClassifiedApiError } from "./error-classifier";

export interface RetryOptions {
  maxAttempts?: number;
  /** Base backoff in ms; actual = min(base * 2^attempt, maxBackoffMs) + jitter. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Called when a credential-rotatable error occurs; may return a new key. */
  onRotate?: (error: ClassifiedApiError) => string | null | Promise<string | null>;
  /** Called after each attempt with the classified result, for logging/metrics. */
  onAttempt?: (info: { attempt: number; status?: number; error?: ClassifiedApiError }) => void;
  /** AbortSignal to cancel retrying. */
  signal?: AbortSignal;
  /** Sleep function (overridable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  maxAttempts: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 8000,
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort);
  });
}

function backoffDelay(attempt: number, base: number, max: number): number {
  const exp = Math.min(base * Math.pow(2, attempt), max);
  const jitter = Math.random() * 250;
  return exp + jitter;
}

export interface RetryResult<T> {
  ok: boolean;
  value?: T;
  status?: number;
  response?: Response;
  error?: ClassifiedApiError;
  attempts: number;
}

/**
 * Run an async operation that produces a `Response` (or throws), retrying
 * transient failures and rotating credentials when appropriate.
 *
 * `operation` receives the credential to use (the initial value or a rotated
 * one) so callers can inject it into headers. It should return the `Response`.
 */
export async function withRetry(
  operation: (credential: string | null) => Promise<Response>,
  initialCredential: string | null,
  options: RetryOptions = {}
): Promise<RetryResult<Response>> {
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULTS.baseBackoffMs;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  const sleep = options.sleep ?? ((ms: number) => defaultSleep(ms, options.signal));

  let credential = initialCredential;
  let lastError: ClassifiedApiError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        attempts: attempt,
        error: {
          category: "unknown",
          retryable: false,
          rotateCredential: false,
          reduceContext: false,
          message: "aborted",
        },
      };
    }

    let response: Response;
    try {
      response = await operation(credential);
    } catch (thrown) {
      const error = classifyApiError({ error: thrown });
      lastError = error;
      options.onAttempt?.({ attempt, error });
      if (!error.retryable || attempt >= maxAttempts - 1) {
        return { ok: false, attempts: attempt + 1, error };
      }
      await sleep(backoffDelay(attempt, baseBackoffMs, maxBackoffMs));
      continue;
    }

    if (response.ok) {
      return {
        ok: true,
        value: response,
        response,
        status: response.status,
        attempts: attempt + 1,
      };
    }

    const bodyText = await response.text().catch(() => "");
    const error = classifyApiError({ status: response.status, body: bodyText });
    lastError = error;
    options.onAttempt?.({ attempt, status: response.status, error });

    // Rotate credential first if the error suggests it might help.
    if (error.rotateCredential && options.onRotate) {
      const next = await options.onRotate(error);
      if (next) credential = next;
    }

    if (!error.retryable || attempt >= maxAttempts - 1) {
      return { ok: false, response, status: response.status, attempts: attempt + 1, error };
    }

    await sleep(backoffDelay(attempt, baseBackoffMs, maxBackoffMs));
  }

  return { ok: false, attempts: maxAttempts, error: lastError };
}
