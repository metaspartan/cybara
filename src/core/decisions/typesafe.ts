import {
  DEFAULT_DECISION_TIMEOUT_MS,
  DECISION_CONTRACT_VERSION,
  type DecisionAnswer,
  type DecisionBatch,
  type DecisionEvaluation,
  type DecisionEvaluationContext,
  type DecisionProvider,
  type DecisionUsage,
  type DecisionUnavailableReason,
} from "./types";

export const TYPESAFE_DECISION_PROVIDER_ID = "typesafe";

export const TYPESAFE_SYSTEM_ONE_PATH = "/v1/systemone";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

interface TypesafeConfig {
  baseUrl?: string;
  apiKey?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampProbability(value: unknown): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeProbabilities(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = toFiniteNumber(raw);
    if (parsed !== null) out[key] = parsed;
  }
  return out;
}

function normalizeUsage(value: unknown): DecisionUsage {
  if (!isRecord(value)) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: toFiniteNumber(value.input_tokens ?? value.inputTokens) ?? 0,
    outputTokens: toFiniteNumber(value.output_tokens ?? value.outputTokens) ?? 0,
  };
}

export function normalizeDecisionAnswer(value: unknown): DecisionAnswer | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (type === "noul") {
    return {
      type: "noul",
      probability: clampProbability(value.probability),
      ...(toFiniteNumber(value.confidence) !== null
        ? { confidence: clampProbability(value.confidence) }
        : {}),
    };
  }
  if (type === "choice") {
    const choice = value.choice;
    if (typeof choice !== "string") return null;
    return {
      type: "choice",
      choice,
      probabilities: normalizeProbabilities(value.probabilities),
      ...(toFiniteNumber(value.confidence) !== null
        ? { confidence: clampProbability(value.confidence) }
        : {}),
    };
  }
  if (type === "score") {
    const score = toFiniteNumber(value.score);
    if (score === null) return null;
    return {
      type: "score",
      score,
      probabilities: normalizeProbabilities(value.probabilities),
      ...(toFiniteNumber(value.confidence) !== null
        ? { confidence: clampProbability(value.confidence) }
        : {}),
    };
  }
  return null;
}

export function classifyDecisionHttpStatus(status: number): DecisionUnavailableReason {
  if (status === 401 || status === 403) return "authentication";
  if (status === 413 || status === 422) return "unsupported-input";
  if (status === 429) return "rate-limited";
  if (status === 529) return "provider-overloaded";
  return "transport";
}

export function decisionEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith(TYPESAFE_SYSTEM_ONE_PATH)) return trimmed;
  return `${trimmed}${TYPESAFE_SYSTEM_ONE_PATH}`;
}

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl.trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function resolveDecisionConfig(config: TypesafeConfig | undefined): {
  baseUrl: string | null;
  apiKey: string | null;
} {
  const baseUrl = config?.baseUrl?.trim();
  const apiKey = config?.apiKey?.trim();
  if (!baseUrl) return { baseUrl: null, apiKey: null };
  if (isLoopbackBaseUrl(baseUrl)) {
    return { baseUrl, apiKey: null };
  }
  return { baseUrl, apiKey: apiKey ?? null };
}

function mergeSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
    timedOut: () => didTimeout,
  };
}

export class TypesafeDecisionProvider implements DecisionProvider {
  readonly id = TYPESAFE_DECISION_PROVIDER_ID;
  readonly contractVersion = DECISION_CONTRACT_VERSION;

  constructor(private readonly config: TypesafeConfig) {}

  isReady(): boolean {
    const { baseUrl, apiKey } = resolveDecisionConfig(this.config);
    if (!baseUrl) return false;
    if (isLoopbackBaseUrl(baseUrl)) return true;
    return Boolean(apiKey);
  }

  async evaluate(
    batch: DecisionBatch,
    context: DecisionEvaluationContext
  ): Promise<DecisionEvaluation> {
    const { baseUrl, apiKey } = resolveDecisionConfig(this.config);
    if (!baseUrl) {
      return { ok: false, reason: "not-configured", detail: "No decision endpoint configured" };
    }
    if (!isLoopbackBaseUrl(baseUrl) && !apiKey) {
      return { ok: false, reason: "not-configured", detail: "Missing decision API credential" };
    }

    const timeoutMs = context.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
    const { signal, cleanup, timedOut } = mergeSignals(context.signal, timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const response = await fetch(decisionEndpoint(baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({
          state: batch.state,
          model: context.model,
          questions: batch.questions,
        }),
        signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          reason: classifyDecisionHttpStatus(response.status),
          detail: `decision endpoint returned ${response.status}`,
        };
      }

      const payload = (await response.json()) as unknown;
      if (!isRecord(payload)) {
        return { ok: false, reason: "transport", detail: "malformed decision response" };
      }
      if (!isRecord(payload.answers)) {
        return { ok: false, reason: "transport", detail: "decision response has no answers" };
      }

      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, raw] of Object.entries(payload.answers)) {
        const normalized = normalizeDecisionAnswer(raw);
        if (!normalized) {
          return {
            ok: false,
            reason: "transport",
            detail: `decision answer "${id}" was not a supported type`,
          };
        }
        answers[id] = normalized;
      }

      const requested = Object.keys(batch.questions);
      const missing = requested.filter((id) => !(id in answers));
      if (missing.length > 0) {
        return {
          ok: false,
          reason: "transport",
          detail: `decision response omitted: ${missing.join(", ")}`,
        };
      }

      return {
        ok: true,
        model: typeof payload.model === "string" ? payload.model : context.model,
        answers,
        usage: normalizeUsage(payload.usage),
      };
    } catch (error) {
      if (timedOut()) {
        return { ok: false, reason: "timeout", detail: `decision timed out after ${timeoutMs}ms` };
      }
      if (context.signal?.aborted) {
        return { ok: false, reason: "cancelled", detail: "decision evaluation cancelled" };
      }
      return {
        ok: false,
        reason: "transport",
        detail: error instanceof Error ? error.message : "decision request failed",
      };
    } finally {
      cleanup();
    }
  }
}
