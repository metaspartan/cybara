export interface TuiPreferences {
  mouseScrolling: boolean;
  scrollStep: number;
}

export const DEFAULT_TUI_PREFERENCES: TuiPreferences = {
  mouseScrolling: true,
  scrollStep: 2,
};

export const tuiScrollStepOptions = [1, 2, 3, 5] as const;

export function normalizeTuiScrollStep(
  value: unknown,
  fallback = DEFAULT_TUI_PREFERENCES.scrollStep
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(8, Math.max(1, Math.round(parsed)));
}

export function normalizeTuiPreferences(value: unknown): TuiPreferences {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    mouseScrolling:
      typeof record.mouseScrolling === "boolean"
        ? record.mouseScrolling
        : DEFAULT_TUI_PREFERENCES.mouseScrolling,
    scrollStep: normalizeTuiScrollStep(record.scrollStep),
  };
}
