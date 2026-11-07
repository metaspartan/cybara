import type { ModelsDevModel } from "./models-dev";
import {
  CURSOR_AVAILABLE_MODELS_URL,
  CURSOR_PICKER_SKIP,
  CURSOR_USABLE_MODELS_URL,
  cursorModels,
} from "./providers/cursor-models";

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  minimal: "Minimal",
  none: "None",
  max: "Max",
};

const EFFORT_PARAM_IDS = ["effort", "reasoning_effort", "reasoning"];

const VARIANT_SUFFIXES = [
  "-fast",
  "-thinking",
  "-extra-high",
  "-xhigh",
  "-minimal",
  "-none",
  "-low",
  "-medium",
  "-high",
  "-max",
];

function familyOf(id: string): string {
  let current = id;
  for (let depth = 0; depth < 4; depth += 1) {
    const next = VARIANT_SUFFIXES.map((suffix) =>
      current.endsWith(suffix) ? current.slice(0, -suffix.length) : null
    ).find((value): value is string => typeof value === "string" && value.length > 0);
    if (!next) break;
    current = next;
  }
  return current;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replaceAll("\u200b", "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

function contextTokens(value: unknown): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([km])$/i.exec(String(value ?? "").trim());
  if (!match) return undefined;
  return Math.round(Number(match[1]) * (match[2].toLowerCase() === "m" ? 1_000_000 : 1_000));
}

function parameterValues(variant: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of (variant.parameterValues as Array<Record<string, unknown>> | undefined) ??
    []) {
    out[String(entry.id)] = String(entry.value);
  }
  return out;
}

function variantLabel(base: string, have: Record<string, string>): string {
  const parts = [base];
  const effort = EFFORT_PARAM_IDS.map((id) => have[id]).find((value) => Boolean(value));
  if (effort && EFFORT_LABELS[effort]) parts.push(EFFORT_LABELS[effort]);
  if (have.fast === "true") parts.push("Fast");
  if (have.thinking === "true") parts.push("Thinking");
  else if (have.thinking === "false") parts.push("No Thinking");
  return parts.join(" ");
}

function variantContext(
  model: Record<string, unknown>,
  variant: Record<string, unknown>
): number | undefined {
  const have = parameterValues(variant);
  const parsed = contextTokens(have.context);
  if (parsed !== undefined) return parsed;
  if (variant.isMaxMode === true) return positiveInteger(model.contextTokenLimitForMaxMode);
  return positiveInteger(model.contextTokenLimit);
}

export function parseCursorModels(body: unknown): ModelsDevModel[] {
  const payload = recordValue(body);
  const models = payload?.models;
  if (!Array.isArray(models)) return [];
  const out: ModelsDevModel[] = [];
  const seen = new Set<string>();
  const push = (
    id: string,
    name: string,
    contextWindow: number | undefined,
    reasoning: boolean,
    input: string[]
  ): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, contextWindow, reasoning, input });
  };

  for (const entry of models) {
    const model = recordValue(entry);
    if (!model) continue;
    if (model.isHidden === true) continue;
    const modelName = typeof model.name === "string" ? model.name : "";
    if (!modelName) continue;
    if (CURSOR_PICKER_SKIP.has(modelName)) continue;
    const base = cleanText(model.clientDisplayName) || cleanText(model.inputboxShortModelName);
    const reasoning = model.supportsThinking === true;
    const input = model.supportsImages === true ? ["text", "image"] : ["text"];
    const variants = (model.variants as Array<Record<string, unknown>> | undefined) ?? [];
    for (const variant of variants) {
      const slug = variant.legacySlug;
      if (typeof slug !== "string" || !slug) continue;
      const have = parameterValues(variant);
      push(
        slug,
        variantLabel(base || slug, have),
        variantContext(model, variant),
        reasoning,
        input
      );
    }
    const variantSlugs = new Set(variants.map((variant) => String(variant.legacySlug ?? "")));
    for (const slug of (model.legacySlugs as string[] | undefined) ?? []) {
      if (typeof slug !== "string" || !slug || variantSlugs.has(slug)) continue;
      push(slug, base || slug, positiveInteger(model.contextTokenLimit), reasoning, input);
    }
    push(modelName, base || modelName, positiveInteger(model.contextTokenLimit), reasoning, input);
  }
  return out;
}

export function parseCursorUsableModels(body: unknown): string[] {
  const payload = recordValue(body);
  const models = payload?.models;
  if (!Array.isArray(models)) return [];
  const ids: string[] = [];
  for (const entry of models) {
    const model = recordValue(entry);
    const id = typeof model?.modelId === "string" ? model.modelId : "";
    if (id) ids.push(id);
  }
  return ids;
}

export function cursorUsableOnlyModels(
  picker: readonly ModelsDevModel[],
  usableIds: readonly string[]
): ModelsDevModel[] {
  const known = new Set(picker.map((model) => model.id));
  const families = new Set<string>();
  for (const id of usableIds) {
    const family = familyOf(id);
    if (!family || known.has(family)) continue;
    families.add(family);
  }
  const catalog = new Map(cursorModels.map((model) => [model.id, model] as const));
  return [...families].map((id) => {
    const entry = catalog.get(id);
    return {
      id,
      name: entry?.name ?? id,
      contextWindow: entry?.context,
      reasoning: entry?.reasoning ?? true,
      input: entry?.input ?? ["text"],
    };
  });
}

async function cursorPost(
  url: string,
  token: string,
  body: unknown,
  request: typeof globalThis.fetch
): Promise<unknown> {
  const response = await request(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      Authorization: `Bearer ${token}`,
      "x-cursor-client-type": "cli",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Cursor model discovery returned ${response.status}`);
  return response.json();
}

export async function discoverCursorModels(
  token: string,
  request: typeof globalThis.fetch = globalThis.fetch
): Promise<ModelsDevModel[]> {
  const picker = parseCursorModels(
    await cursorPost(
      CURSOR_AVAILABLE_MODELS_URL,
      token,
      { useModelParameters: true, doNotUseMarkdown: true },
      request
    )
  );
  const usableIds = await cursorPost(CURSOR_USABLE_MODELS_URL, token, {}, request)
    .then(parseCursorUsableModels)
    .catch(() => [] as string[]);
  return [...picker, ...cursorUsableOnlyModels(picker, usableIds)];
}
