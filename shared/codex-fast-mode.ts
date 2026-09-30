export const CODEX_FAST_MODE_SERVICE_TIER = "priority";
export const CODEX_ULTRAFAST_MODE_SERVICE_TIER = "ultrafast";

const FAST_MODE_MIN_MAJOR = 6;
const FAST_MODE_MIN_5_MINOR = 4;
const FAST_MODE_EXCLUDED_SUFFIXES = ["-spark", "-pro", "-nano"];
const ULTRAFAST_MODE_MODEL = /^gpt-\d+-astra(?:-|$)/;
const MODEL_VERSION = /^gpt-(\d+)(?:\.(\d+))?/;

interface ModelVersion {
  major: number;
  minor: number;
}

function normalizeModelId(modelId: string | null | undefined): string {
  return typeof modelId === "string" ? modelId.trim().toLowerCase() : "";
}

function modelVersion(model: string): ModelVersion | null {
  const match = MODEL_VERSION.exec(model);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
  };
}

export function supportsCodexFastMode(modelId: string | null | undefined): boolean {
  const model = normalizeModelId(modelId);
  if (!model) return false;
  const version = modelVersion(model);
  if (!version) return false;
  const familySupported =
    version.major >= FAST_MODE_MIN_MAJOR ||
    (version.major === FAST_MODE_MIN_MAJOR - 1 && version.minor >= FAST_MODE_MIN_5_MINOR);
  if (!familySupported) return false;
  return !FAST_MODE_EXCLUDED_SUFFIXES.some((suffix) => model.endsWith(suffix));
}

export function supportsCodexUltrafastMode(modelId: string | null | undefined): boolean {
  return ULTRAFAST_MODE_MODEL.test(normalizeModelId(modelId));
}

export function codexFastModeServiceTier(
  enabled: boolean,
  modelId: string | null | undefined
): string | null {
  return enabled && supportsCodexFastMode(modelId) ? CODEX_FAST_MODE_SERVICE_TIER : null;
}

export function codexUltrafastServiceTier(
  enabled: boolean,
  modelId: string | null | undefined
): string | null {
  return enabled && supportsCodexUltrafastMode(modelId)
    ? CODEX_ULTRAFAST_MODE_SERVICE_TIER
    : null;
}

export function codexServiceTier(options: {
  fastMode: boolean;
  ultrafastMode: boolean;
  modelId: string | null | undefined;
}): string | null {
  return (
    codexUltrafastServiceTier(options.ultrafastMode, options.modelId) ??
    codexFastModeServiceTier(options.fastMode, options.modelId)
  );
}
