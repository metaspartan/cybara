import {
  evaluateWithDecisionModel,
  getDefaultDecisionModel,
  isDecisionModelKnown,
  listDecisionModels,
  parseDecisionModelRef,
} from "../../decisions/registry";
import { MAX_DECISION_QUESTIONS, MAX_DECISION_STATE_CHARS } from "../../decisions/types";
import { validateDecisionBatch } from "../../decisions/validation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveModelRef(args: Record<string, unknown>): string | { error: string } {
  const override = args.model;
  if (typeof override === "string" && override.trim()) {
    const ref = override.trim();
    if (!isDecisionModelKnown(ref)) {
      return {
        error: `Unknown decision model "${ref}". Known: ${listDecisionModels()
          .map((m) => m.id)
          .join(", ")}`,
      };
    }
    return ref;
  }
  const fallback = getDefaultDecisionModel();
  if (!fallback) {
    return {
      error:
        "No decision model is selected. Pass model explicitly or set a default decision model.",
    };
  }
  return fallback;
}

export async function handleDecisionEvaluate(
  args: Record<string, unknown>,
  context?: { agentId?: string; abortSignal?: AbortSignal }
): Promise<unknown> {
  const ref = resolveModelRef(args);
  if (typeof ref !== "string") return { ok: false, error: ref.error };

  const selection = parseDecisionModelRef(ref);
  if ("error" in selection) return { ok: false, error: selection.error };

  const batchInput = { state: args.state, questions: args.questions };
  const validated = validateDecisionBatch(batchInput);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const result = await evaluateWithDecisionModel(selection, validated.batch, {
    agentId: context?.agentId,
    signal: context?.abortSignal,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      detail: result.detail,
      hint: unavailableHint(result.reason),
    };
  }

  return {
    ok: true,
    model: result.model,
    answers: result.answers,
    usage: result.usage,
  };
}

export function handleDecisionList(): unknown {
  return {
    ok: true,
    models: listDecisionModels(),
    defaultModel: getDefaultDecisionModel(),
    limits: {
      maxQuestions: MAX_DECISION_QUESTIONS,
      maxStateChars: MAX_DECISION_STATE_CHARS,
    },
  };
}

function unavailableHint(reason: string): string | undefined {
  switch (reason) {
    case "not-configured":
      return "Configure a decision endpoint and credential, or select a decision model.";
    case "unsupported-input":
      return "Reduce the state size or simplify the questions; this is a bounded-evaluation API.";
    case "rate-limited":
    case "provider-overloaded":
      return "Back off briefly and retry.";
    case "timeout":
      return "Retry with less evidence or fewer questions.";
    case "authentication":
      return "The configured decision credential was rejected.";
    default:
      return undefined;
  }
}
