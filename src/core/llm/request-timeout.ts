// A hung provider socket must not stall an agent turn indefinitely; every LLM
// request gets a hard timeout on top of the caller's interrupt signal.
export const LLM_REQUEST_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CYBARA_LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 10_000 ? raw : 300_000;
})();

export function withLlmRequestTimeout(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export function normalizeLlmTimeoutError(error: unknown, callerSignal?: AbortSignal): unknown {
  const name = (error as { name?: string } | null)?.name;
  if ((name === "TimeoutError" || name === "AbortError") && !callerSignal?.aborted) {
    return new Error(
      `LLM request timed out after ${Math.round(LLM_REQUEST_TIMEOUT_MS / 1000)}s (provider did not respond)`
    );
  }
  return error;
}
