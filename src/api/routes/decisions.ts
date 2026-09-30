import {
  decisionProviderById,
  getDefaultDecisionModel,
  getStoredDecisionConfig,
  isDecisionModelKnown,
  listDecisionModels,
  parseDecisionModelRef,
  setDefaultDecisionModel,
  setStoredDecisionConfig,
} from "../../core/decisions/registry";
import { makeRawHttpResponse, type RouteHandler } from "./_shared";

interface DecisionSettingsBody {
  base_url?: unknown;
  api_key?: unknown;
  model?: unknown;
}

type SettableField = string | null | undefined;

function readBaseUrl(value: unknown): SettableField {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("base_url must be a string");
  return value.trim() || null;
}

function readApiKey(value: unknown): SettableField {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("api_key must be a string");
  return value.trim() || null;
}

function resolveField(next: SettableField, current: string | undefined): string | undefined {
  if (next === undefined) return current;
  return next ?? undefined;
}

function readModel(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new Error("model must be a string");
  const ref = parseDecisionModelRef(value);
  if ("error" in ref) throw new Error(ref.error);
  if (!isDecisionModelKnown(value)) throw new Error(`Unknown decision model ${value}`);
  return value.trim();
}

function providerIdForModel(model: string): string {
  if (!model) return "";
  const parsed = parseDecisionModelRef(model);
  return "error" in parsed ? "" : parsed.providerId;
}

export function decisionSettingsResponse(): Record<string, unknown> {
  const stored = getStoredDecisionConfig();
  const model = getDefaultDecisionModel();
  const providerId = providerIdForModel(model);
  return {
    models: listDecisionModels(),
    base_url: stored.baseUrl ?? "",
    has_api_key: Boolean(stored.apiKey),
    model,
    provider_ready: providerId ? Boolean(decisionProviderById(providerId)?.isReady()) : false,
  };
}

export const decisionRoutes: Record<string, RouteHandler> = {
  "GET /api/settings/decisions": () => decisionSettingsResponse(),
  "PUT /api/settings/decisions": (raw: unknown) => {
    const body = (raw ?? {}) as DecisionSettingsBody;
    let nextBaseUrl: SettableField;
    let nextApiKey: SettableField;
    let nextModel: string | undefined;
    try {
      nextBaseUrl = body.base_url !== undefined ? readBaseUrl(body.base_url) : undefined;
      nextApiKey = body.api_key !== undefined ? readApiKey(body.api_key) : undefined;
      nextModel = body.model !== undefined ? readModel(body.model) : undefined;
    } catch (error) {
      return makeRawHttpResponse(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Invalid decision settings",
        }),
        "application/json",
        400
      );
    }

    if (body.base_url !== undefined || body.api_key !== undefined) {
      const stored = getStoredDecisionConfig();
      setStoredDecisionConfig({
        baseUrl: resolveField(nextBaseUrl, stored.baseUrl),
        apiKey: resolveField(nextApiKey, stored.apiKey),
      });
    }
    if (nextModel !== undefined) {
      setDefaultDecisionModel(nextModel);
    }
    return { success: true, ...decisionSettingsResponse() };
  },
};
