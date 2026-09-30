export type DecisionQuestionType = "noul" | "choice" | "score";

export interface DecisionNoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export interface DecisionChoiceQuestion {
  type: "choice";
  instructions: string;
  options: string[];
  criteria?: Record<string, string>;
}

export interface DecisionScoreQuestion {
  type: "score";
  instructions: string;
  legend: Record<string, string>;
}

export type DecisionQuestion =
  | DecisionNoulQuestion
  | DecisionChoiceQuestion
  | DecisionScoreQuestion;

export type DecisionInput = string | Record<string, unknown> | unknown[];

export interface DecisionBatch {
  state: DecisionInput;
  questions: Record<string, DecisionQuestion>;
}

export interface DecisionAnswerBase {
  type: DecisionQuestionType;
  confidence?: number;
}

export interface DecisionNoulAnswer extends DecisionAnswerBase {
  type: "noul";
  probability: number;
}

export interface DecisionChoiceAnswer extends DecisionAnswerBase {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
}

export interface DecisionScoreAnswer extends DecisionAnswerBase {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
}

export type DecisionAnswer = DecisionNoulAnswer | DecisionChoiceAnswer | DecisionScoreAnswer;

export type DecisionUnavailableReason =
  | "not-configured"
  | "unsupported-input"
  | "authentication"
  | "rate-limited"
  | "provider-overloaded"
  | "timeout"
  | "cancelled"
  | "transport";

export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
}

export type DecisionEvaluation =
  | { ok: true; model: string; answers: Record<string, DecisionAnswer>; usage: DecisionUsage }
  | { ok: false; reason: DecisionUnavailableReason; detail?: string };

export interface DecisionEvaluationContext {
  model: string;
  agentId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DecisionProvider {
  readonly id: string;
  readonly contractVersion: 1;
  isReady(): boolean;
  evaluate(batch: DecisionBatch, context: DecisionEvaluationContext): Promise<DecisionEvaluation>;
}

export interface DecisionModelDescriptor {
  id: string;
  name: string;
  provider: string;
  questionTypes: DecisionQuestionType[];
}

export const DECISION_CONTRACT_VERSION = 1 as const;

export const DEFAULT_DECISION_TIMEOUT_MS = 30_000;

export const MAX_DECISION_STATE_CHARS = 200_000;

export const MAX_DECISION_QUESTIONS = 16;

export function decisionQuestionTypes(): DecisionQuestionType[] {
  return ["noul", "choice", "score"];
}
