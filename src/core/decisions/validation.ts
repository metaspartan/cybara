import {
  MAX_DECISION_QUESTIONS,
  MAX_DECISION_STATE_CHARS,
  type DecisionBatch,
  type DecisionInput,
  type DecisionQuestion,
  type DecisionQuestionType,
} from "./types";

const ALLOWED_TYPES: readonly DecisionQuestionType[] = ["noul", "choice", "score"];

export type DecisionValidationResult =
  | { ok: true; batch: DecisionBatch }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function estimateChars(value: DecisionInput): number {
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function validateDecisionQuestion(value: unknown): DecisionQuestion | string {
  if (!isRecord(value)) return "question must be an object";
  const type = value.type;
  if (typeof type !== "string" || !ALLOWED_TYPES.includes(type as DecisionQuestionType)) {
    return `question type must be one of ${ALLOWED_TYPES.join(", ")}`;
  }
  const instructions = value.instructions;
  if (typeof instructions !== "string" || !instructions.trim()) {
    return "question instructions must be a non-empty string";
  }

  if (type === "choice") {
    const options = value.options;
    if (!Array.isArray(options) || options.length < 2) {
      return "choice questions require at least two options";
    }
    if (options.some((option) => typeof option !== "string" || !option.trim())) {
      return "choice options must all be non-empty strings";
    }
    if (new Set(options).size !== options.length) {
      return "choice options must be unique";
    }
  }

  if (type === "score") {
    const legend = value.legend;
    if (!isRecord(legend) || Object.keys(legend).length < 2) {
      return "score questions require a legend with at least two entries";
    }
    const keysAreNumbers = Object.keys(legend).every((key) => Number.isFinite(Number(key)));
    if (!keysAreNumbers) return "score legend keys must be numeric";
  }

  return {
    type,
    instructions,
    ...(isRecord(value.criteria) ? { criteria: value.criteria } : {}),
    ...(type === "choice" ? { options: value.options as string[] } : {}),
    ...(type === "score" ? { legend: value.legend as Record<string, string> } : {}),
  } as DecisionQuestion;
}

export function validateDecisionBatch(value: unknown): DecisionValidationResult {
  if (!isRecord(value)) return { ok: false, error: "batch must be an object" };

  const state = value.state;
  if (typeof state !== "string" && !isRecord(state) && !Array.isArray(state)) {
    return { ok: false, error: "state must be a string, object, or array" };
  }
  if (estimateChars(state as DecisionInput) > MAX_DECISION_STATE_CHARS) {
    return {
      ok: false,
      error: `state exceeds ${MAX_DECISION_STATE_CHARS} characters`,
    };
  }

  const questions = value.questions;
  if (!isRecord(questions)) {
    return {
      ok: false,
      error:
        'questions must be an object mapping question ids to question objects, for example {"q1":{"type":"noul","instructions":"does this compile"}}. An array of questions is not accepted.',
    };
  }
  const entries = Object.entries(questions);
  if (entries.length === 0) return { ok: false, error: "at least one question is required" };
  if (entries.length > MAX_DECISION_QUESTIONS) {
    return { ok: false, error: `at most ${MAX_DECISION_QUESTIONS} questions are supported` };
  }

  const validated: Record<string, DecisionQuestion> = {};
  for (const [id, question] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) {
      return { ok: false, error: `question id "${id}" must be 1-64 word characters` };
    }
    const result = validateDecisionQuestion(question);
    if (typeof result === "string") return { ok: false, error: `${id}: ${result}` };
    validated[id] = result;
  }

  return {
    ok: true,
    batch: { state: state as DecisionInput, questions: validated },
  };
}
