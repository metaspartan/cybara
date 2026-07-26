export const CODEX_FAST_MODE_SERVICE_TIER = "priority";

const FAST_MODE_FAMILIES = ["gpt-5.4", "gpt-5.5", "gpt-5.6"];
const FAST_MODE_EXCLUDED_SUFFIXES = ["-spark", "-pro", "-nano"];

export function supportsCodexFastMode(modelId: string | null | undefined): boolean {
  if (typeof modelId !== "string") return false;
  const model = modelId.trim().toLowerCase();
  if (!model) return false;
  const family = FAST_MODE_FAMILIES.find(
    (candidate) => model === candidate || model.startsWith(`${candidate}-`)
  );
  if (!family) return false;
  return !FAST_MODE_EXCLUDED_SUFFIXES.some((suffix) => model.endsWith(suffix));
}

export function codexFastModeServiceTier(
  enabled: boolean,
  modelId: string | null | undefined
): string | null {
  return enabled && supportsCodexFastMode(modelId) ? CODEX_FAST_MODE_SERVICE_TIER : null;
}
