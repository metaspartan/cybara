import { OPENAI_CODEX_JWT_CLAIM_PATH } from "./agent-internals";
import type { ModelsDevModel } from "./models-dev";

const OPENAI_CODEX_MODEL_URL = "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function positiveInteger(
  record: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  }
  return undefined;
}

function stringArray(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
  }
  return [];
}

function reasoningLevels(record: Record<string, unknown>): string[] {
  const value = record.supported_reasoning_levels ?? record.supportedReasoningLevels;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry.trim()];
    const nested = recordValue(entry);
    const effort = nested?.effort;
    return typeof effort === "string" && effort.trim() ? [effort.trim()] : [];
  });
}

function inputTypes(record: Record<string, unknown>): string[] {
  const modalities = stringArray(record, ["input_modalities", "inputModalities"]);
  const normalized = new Set(modalities.map((value) => value.trim().toLowerCase()));
  const input: string[] = [];
  if (normalized.has("text")) input.push("text");
  if (normalized.has("image") || normalized.has("vision")) input.push("image");
  if (normalized.has("audio")) input.push("audio");
  if (normalized.has("video")) input.push("video");
  return input.length > 0 ? input : ["text", "image"];
}

export function extractOpenAICodexAccountId(token: string): string | undefined {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payloadPart = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const payload = recordValue(JSON.parse(Buffer.from(payloadPart, "base64").toString("utf8")));
    const authClaim = recordValue(payload?.[OPENAI_CODEX_JWT_CLAIM_PATH]);
    const accountId = authClaim?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function getOpenAICodexModelCandidates(modelId: string): string[] {
  const normalized = modelId.trim().toLowerCase();
  const fallbacks: Record<string, string[]> = {
    "gpt-5.6-luna": ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"],
    "gpt-5.6-terra": ["gpt-5.6-sol", "gpt-5.5", "gpt-5.4"],
    "gpt-5.6-sol": ["gpt-5.5", "gpt-5.4"],
    "gpt-5-codex": ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.2"],
    "gpt-5.3-codex-spark": ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.2"],
    "gpt-5.3-codex": ["gpt-5.2-codex", "gpt-5.2"],
    "gpt-5.2-codex": ["gpt-5.2"],
  };
  const seen = new Set<string>();
  return [modelId, ...(fallbacks[normalized] ?? [])].filter((candidate) => {
    const key = candidate.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function shouldRetryOpenAICodexModel(status: number, errorText: string): boolean {
  if (status !== 400 && status !== 404) return false;
  const normalized = errorText.toLowerCase();
  return ["model not found", "model_not_found", "does not exist", "no access to this model"].some(
    (phrase) => normalized.includes(phrase)
  );
}

export function parseOpenAICodexModels(body: unknown): ModelsDevModel[] {
  const root = recordValue(body);
  const rows = root?.models;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const record = recordValue(row);
    if (!record) return [];
    const visibility = stringValue(record, ["visibility"])?.toLowerCase();
    if (visibility && visibility !== "list") return [];
    if (record.show_in_picker === false || record.showInPicker === false) return [];
    const id = stringValue(record, ["slug", "id"]);
    if (!id) return [];
    return [
      {
        id,
        name: stringValue(record, ["display_name", "displayName", "name"]) ?? id,
        contextWindow:
          positiveInteger(record, ["max_context_window", "maxContextWindow"]) ??
          positiveInteger(record, ["context_window", "contextWindow"]),
        maxTokens: positiveInteger(record, [
          "max_output_tokens",
          "maxOutputTokens",
          "max_completion_tokens",
          "maxCompletionTokens",
        ]),
        reasoning: reasoningLevels(record).length > 0,
        input: inputTypes(record),
      },
    ];
  });
}

export async function discoverOpenAICodexModels(
  token: string,
  request: typeof globalThis.fetch = globalThis.fetch
): Promise<ModelsDevModel[]> {
  const accountId = extractOpenAICodexAccountId(token);
  const response = await request(OPENAI_CODEX_MODEL_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`OpenAI Codex model discovery returned ${response.status}`);
  return parseOpenAICodexModels(await response.json());
}
