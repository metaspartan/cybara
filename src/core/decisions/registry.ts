import { config } from "../config";
import { openSecret, sealSecret } from "../secret-storage";
import {
  DEFAULT_DECISION_TIMEOUT_MS,
  decisionQuestionTypes,
  type DecisionEvaluation,
  type DecisionEvaluationContext,
  type DecisionModelDescriptor,
  type DecisionProvider,
} from "./types";
import { TypesafeDecisionProvider } from "./typesafe";

const DECISION_CONFIG_KEY = "decisions.typesafe";
const DECISION_MODEL_KEY = "decisions.defaultModel";

export interface StoredDecisionConfig {
  baseUrl?: string;
  apiKey?: string;
}

export interface DecisionSelection {
  providerId: string;
  model: string;
}

export const TYPESAFE_DECISION_MODELS: DecisionModelDescriptor[] = [
  {
    id: "typesafe/jev-latest",
    name: "Jev",
    provider: "typesafe",
    questionTypes: decisionQuestionTypes(),
  },
  {
    id: "typesafe/jev-1.13.0",
    name: "Jev 1.13.0",
    provider: "typesafe",
    questionTypes: decisionQuestionTypes(),
  },
  {
    id: "typesafe/kev-latest",
    name: "Kev",
    provider: "typesafe",
    questionTypes: decisionQuestionTypes(),
  },
];

export function listDecisionModels(): DecisionModelDescriptor[] {
  return TYPESAFE_DECISION_MODELS.map((model) => ({ ...model }));
}

function sealConfig(stored: StoredDecisionConfig): StoredDecisionConfig {
  if (!stored.apiKey) return { baseUrl: stored.baseUrl };
  return {
    baseUrl: stored.baseUrl,
    apiKey: sealSecret(stored.apiKey, "decisions.typesafe"),
  };
}

export function getStoredDecisionConfig(): StoredDecisionConfig {
  const stored = config.get<StoredDecisionConfig>(DECISION_CONFIG_KEY);
  if (!stored) return {};
  if (stored.apiKey) {
    try {
      return { baseUrl: stored.baseUrl, apiKey: openSecret(stored.apiKey, "decisions.typesafe") };
    } catch {
      return { baseUrl: stored.baseUrl };
    }
  }
  return { baseUrl: stored.baseUrl };
}

export function setStoredDecisionConfig(stored: StoredDecisionConfig): void {
  config.set(DECISION_CONFIG_KEY, sealConfig(stored));
}

export function getDefaultDecisionModel(): string {
  return config.get<string>(DECISION_MODEL_KEY) ?? "";
}

export function setDefaultDecisionModel(model: string): void {
  config.set(DECISION_MODEL_KEY, model);
}

export function parseDecisionModelRef(ref: string): DecisionSelection | { error: string } {
  const trimmed = ref.trim();
  if (!trimmed) return { error: "decision model reference is empty" };
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return { error: "decision model must be in the form provider/model" };
  }
  return {
    providerId: trimmed.slice(0, separator),
    model: trimmed.slice(separator + 1),
  };
}

export function decisionProviderById(providerId: string): DecisionProvider | null {
  if (providerId === "typesafe") return new TypesafeDecisionProvider(getStoredDecisionConfig());
  return null;
}

export function isDecisionModelKnown(ref: string): boolean {
  return TYPESAFE_DECISION_MODELS.some((model) => model.id === ref.trim());
}

export interface RunDecisionOptions {
  agentId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function evaluateWithDecisionModel(
  selection: DecisionSelection,
  batch: Parameters<DecisionProvider["evaluate"]>[0],
  options: RunDecisionOptions = {}
): Promise<DecisionEvaluation> {
  const provider = decisionProviderById(selection.providerId);
  if (!provider) {
    return {
      ok: false,
      reason: "not-configured",
      detail: `Unknown decision provider ${selection.providerId}`,
    };
  }
  if (!provider.isReady()) {
    return {
      ok: false,
      reason: "not-configured",
      detail: `Decision provider ${provider.id} is not ready`,
    };
  }
  const context: DecisionEvaluationContext = {
    model: selection.model,
    agentId: options.agentId,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS,
  };
  return provider.evaluate(batch, context);
}
