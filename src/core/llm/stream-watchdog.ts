import { config } from "../config";

export interface StreamWatchdogOptions {
  firstChunkMs?: number;
  stallMs?: number;
  totalMs?: number;
  callerSignal?: AbortSignal;
  label?: string;
}

export interface StreamWatchdog {
  signal: AbortSignal;
  heartbeat(): void;
  touch(): void;
  dispose(): void;
  timedOutReason(): string | null;
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
  const configured = config.getLlmTimeoutSettings();
  const configuredFirstMs = local
    ? Math.max(configured.firstTokenSeconds * 1000, 1_800_000)
    : configured.firstTokenSeconds * 1000;
  const configuredStallMs = local ? 0 : configured.stallSeconds * 1000;
  return {
    firstChunkMs: readEnvMs("CYBARA_LLM_FIRST_TOKEN_TIMEOUT_MS", configuredFirstMs),
    stallMs: readEnvMs("CYBARA_LLM_STALL_TIMEOUT_MS", configuredStallMs),
    totalMs: readEnvMs("CYBARA_LLM_TIMEOUT_MS", configured.totalSeconds * 1000),
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
    heartbeat() {
      if (sawFirstChunk) armIdleTimer();
    },
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
