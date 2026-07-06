import { config } from "../config";

// Ceiling for genuinely non-streaming calls only (Anthropic path, providers
// that reject `stream`). Streaming paths use inactivity watchdogs instead
// (see stream-watchdog.ts) and have NO duration cap — agents may run for
// hours. This ceiling exists because a non-streaming response is one silent
// socket read, indistinguishable from a hang; keep it generous and tunable.
export function resolveNonStreamingCeilingMs(): number {
  const raw = Number(process.env.CYBARA_LLM_NONSTREAMING_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 10_000) return raw;
  try {
    return config.getLlmTimeoutSettings().nonStreamingSeconds * 1000;
  } catch {
    return 1_800_000;
  }
}

export function withLlmRequestTimeout(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(resolveNonStreamingCeilingMs());
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export function normalizeLlmTimeoutError(error: unknown, callerSignal?: AbortSignal): unknown {
  const name = (error as { name?: string } | null)?.name;
  if ((name === "TimeoutError" || name === "AbortError") && !callerSignal?.aborted) {
    return new Error(
      `LLM request timed out after ${Math.round(resolveNonStreamingCeilingMs() / 1000)}s (provider did not respond)`
    );
  }
  return error;
}
