/**
 * Inactivity watchdogs for LLM calls. Agent turns may legitimately run for
 * hours, so nothing here caps total duration by default — a request is only
 * killed when the provider goes silent:
 *
 * - first-chunk timeout: no bytes at all since the request started
 * - stall timeout: resets on every streamed chunk once output has begun
 * - optional total cap: off unless explicitly configured
 *
 * Local endpoints get relaxed limits (long prefill before the first token is
 * normal there) and stall detection is disabled for them.
 */

export interface StreamWatchdogOptions {
  firstChunkMs?: number;
  stallMs?: number;
  totalMs?: number;
  callerSignal?: AbortSignal;
  label?: string;
}

export interface StreamWatchdog {
  signal: AbortSignal;
  /** Call on every received chunk/event to prove the stream is alive. */
  touch(): void;
  dispose(): void;
  /** Non-null when this watchdog (not the caller) aborted the request. */
  timedOutReason(): string | null;
  /** Convert an abort raised by this watchdog into a descriptive error. */
  wrapError(error: unknown): unknown;
}

function readEnvMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export function isLocalLlmEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "host.docker.internal" ||
      host.endsWith(".local") ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

export function resolveLlmWatchdogDefaults(baseUrl: string): {
  firstChunkMs: number;
  stallMs: number;
  totalMs: number;
} {
  const local = isLocalLlmEndpoint(baseUrl);
  return {
    // Remote reasoning models can think for minutes before the first byte;
    // local models can spend far longer in prefill on big contexts.
    firstChunkMs: readEnvMs("CYBARA_LLM_FIRST_TOKEN_TIMEOUT_MS", local ? 1_800_000 : 300_000),
    // 0 disables. Local endpoints stream from the same machine — a stalled
    // local stream usually means heavy compute, not a dead socket.
    stallMs: readEnvMs("CYBARA_LLM_STALL_TIMEOUT_MS", local ? 0 : 300_000),
    // No total cap by default: agents are allowed to work for hours as long
    // as the provider keeps talking.
    totalMs: readEnvMs("CYBARA_LLM_TIMEOUT_MS", 0),
  };
}

export function createStreamWatchdog(options: StreamWatchdogOptions = {}): StreamWatchdog {
  const { firstChunkMs = 0, stallMs = 0, totalMs = 0, callerSignal, label = "LLM" } = options;
  const controller = new AbortController();
  let reason: string | null = null;
  let sawFirstChunk = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let totalTimer: ReturnType<typeof setTimeout> | null = null;

  const fire = (why: string) => {
    if (controller.signal.aborted) return;
    reason = why;
    controller.abort();
  };

  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!sawFirstChunk && firstChunkMs > 0) {
      idleTimer = setTimeout(
        () =>
          fire(
            `${label} produced no output for ${Math.round(firstChunkMs / 1000)}s (no first token)`
          ),
        firstChunkMs
      );
    } else if (sawFirstChunk && stallMs > 0) {
      idleTimer = setTimeout(
        () => fire(`${label} stream stalled: no data for ${Math.round(stallMs / 1000)}s`),
        stallMs
      );
    }
  };

  if (totalMs > 0) {
    totalTimer = setTimeout(
      () => fire(`${label} exceeded the configured total cap of ${Math.round(totalMs / 1000)}s`),
      totalMs
    );
  }
  armIdleTimer();

  const onCallerAbort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  if (callerSignal?.aborted) onCallerAbort();

  const dispose = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (totalTimer) clearTimeout(totalTimer);
    idleTimer = null;
    totalTimer = null;
    callerSignal?.removeEventListener("abort", onCallerAbort);
  };

  return {
    signal: controller.signal,
    touch() {
      sawFirstChunk = true;
      armIdleTimer();
    },
    dispose,
    timedOutReason: () => reason,
    wrapError(error: unknown): unknown {
      if (reason && !callerSignal?.aborted) {
        return new Error(reason);
      }
      return error;
    },
  };
}
