import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { useIdentity, useUpdateIdentity, type IdentityConfig } from "@/hooks/useApi";
import { settingsApi } from "@/lib/api";
import { useI18n, languageOptions } from "@/lib/i18n";
import { persistPetEnabled, readPetEnabled } from "@/lib/petPreferences";
import { persistUnreadDotColor, readUnreadDotColor } from "@/lib/unreadPreferences";
import { cn } from "@/lib/settingsFormat";
import {
  customThemeConfigPayload,
  defaultThemeAccentForMode,
  readThemeAccentFromConfig,
  resolveThemeSelectionMode,
  themeAccentKeys,
  themeAccents,
  themeConfigPayload,
  themeModeOptions,
  useUIStore,
  type CustomThemeBundle,
  type ThemeAccent,
  type ThemeMode,
} from "@/stores/uiStore";
import {
  createCustomThemeBundle,
  customThemeId,
  MAX_CUSTOM_THEMES,
  normalizeCustomThemeBundle,
} from "../../../../shared/custom-themes";
import { Copy, Download, Palette, Plus, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CustomThemeEditor } from "./theme/CustomThemeEditor";
import { ThemePresetGrid } from "./theme/ThemePresetGrid";
import { copyCustomTheme, downloadCustomTheme, readCustomThemeFile } from "./theme/themeFiles";

function replaceTheme(themes: CustomThemeBundle[], theme: CustomThemeBundle): CustomThemeBundle[] {
  const existing = themes.findIndex((entry) => entry.id === theme.id);
  if (existing < 0) return [...themes, theme];
  const next = [...themes];
  next[existing] = theme;
  return next;
}

function uniqueThemeId(themes: CustomThemeBundle[], requested: string): string {
  const base = customThemeId(requested);
  if (!themes.some((theme) => theme.id === base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base.slice(0, 60)}-${suffix}`;
    if (!themes.some((theme) => theme.id === candidate)) return candidate;
  }
  return `${base.slice(0, 50)}-${Date.now().toString(36)}`;
}

export function ThemeSettings() {
  const {
    accent,
    activeCustomThemeId,
    addToast,
    customThemes,
    mode,
    selectCustomTheme,
    setAccent,
    setCustomThemeCollection,
    setMode,
    upsertCustomTheme,
  } = useUIStore();
  const { locale, mode: languageMode, setMode: setLanguageMode, t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [savingAccent, setSavingAccent] = useState<ThemeAccent | null>(null);
  const [draftTheme, setDraftTheme] = useState<CustomThemeBundle | null>(null);
  const [petEnabled, setPetEnabled] = useState(() => readPetEnabled());
  const [unreadDotColor, setUnreadDotColor] = useState(() => readUnreadDotColor());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const identityThemeRef = useRef<{ initialized: boolean; value: unknown }>({
    initialized: false,
    value: undefined,
  });
  const { data: identity, isLoading: identityLoading } = useIdentity();
  const updateIdentity = useUpdateIdentity();

  useEffect(() => {
    const identityTheme = identity?.theme;
    if (
      identityThemeRef.current.initialized &&
      Object.is(identityThemeRef.current.value, identityTheme)
    ) {
      return;
    }
    identityThemeRef.current = { initialized: true, value: identityTheme };
    const activeThemeId = useUIStore.getState().activeCustomThemeId;
    const nextMode = resolveThemeSelectionMode(
      identity as unknown as Record<string, unknown> | undefined,
      activeThemeId
    );
    if (nextMode === "custom" && activeThemeId) selectCustomTheme(activeThemeId);
    else setMode(nextMode);
  }, [identity, selectCustomTheme, setMode]);

  useEffect(() => {
    setDraftTheme((current) => {
      if (!activeCustomThemeId) {
        return current && !customThemes.some((theme) => theme.id === current.id) ? current : null;
      }
      if (current?.id === activeCustomThemeId) return current;
      return customThemes.find((theme) => theme.id === activeCustomThemeId) ?? current;
    });
  }, [activeCustomThemeId, customThemes]);

  useEffect(() => {
    let mounted = true;
    const loadGatewayTheme = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        const configAccent = readThemeAccentFromConfig(result.data);
        if (configAccent) setAccent(configAccent);
      } catch {}
    };
    void loadGatewayTheme();
    return () => {
      mounted = false;
    };
  }, [setAccent]);

  const restoreTheme = (
    previousMode: ThemeMode,
    previousThemes: CustomThemeBundle[],
    previousActiveId: string | null
  ) => {
    setCustomThemeCollection({
      version: 1,
      themes: previousThemes,
      activeThemeId: previousActiveId,
    });
    if (previousMode === "custom" && previousActiveId) selectCustomTheme(previousActiveId);
    else setMode(previousMode);
  };

  const updateThemeMode = async (next: ThemeMode) => {
    if (next === "custom" || next === mode) return;
    const previousMode = mode;
    const previousAccent = accent;
    const previousThemes = customThemes;
    const previousActiveId = activeCustomThemeId;
    const previousDraft = draftTheme;
    const nextAccent = defaultThemeAccentForMode(next);
    const current = (identity as IdentityConfig | undefined) ?? {};
    setMode(next);
    setAccent(nextAccent);
    setDraftTheme(null);
    setSavingAccent(nextAccent);
    try {
      const [, accentResult, customResult] = await Promise.all([
        updateIdentity.mutateAsync({ ...current, theme: next }),
        settingsApi.updateConfig(themeConfigPayload(nextAccent)),
        settingsApi.updateConfig(customThemeConfigPayload(customThemes, null)),
      ]);
      if (!accentResult.success || !accentResult.data?.success) {
        throw new Error(accentResult.error || "Highlight update failed");
      }
      if (!customResult.success || !customResult.data?.success) {
        throw new Error(customResult.error || "Theme selection update failed");
      }
      addToast(
        "success",
        `${themeModeOptions.find((option) => option.value === next)?.label} theme applied`
      );
    } catch (error) {
      await Promise.allSettled([
        updateIdentity.mutateAsync({ ...current, theme: previousMode }),
        settingsApi.updateConfig(themeConfigPayload(previousAccent)),
        settingsApi.updateConfig(customThemeConfigPayload(previousThemes, previousActiveId)),
      ]);
      setAccent(previousAccent);
      setDraftTheme(previousDraft);
      restoreTheme(previousMode, previousThemes, previousActiveId);
      addToast("error", error instanceof Error ? error.message : "Failed to update theme");
    } finally {
      setSavingAccent(null);
    }
  };

  const activateCustomTheme = async (theme: CustomThemeBundle) => {
    if (saving) return;
    const previousMode = mode;
    const previousThemes = customThemes;
    const previousActiveId = activeCustomThemeId;
    const previousDraft = draftTheme;
    const current = (identity as IdentityConfig | undefined) ?? {};
    setCustomThemeCollection({ version: 1, themes: customThemes, activeThemeId: theme.id });
    selectCustomTheme(theme.id);
    setDraftTheme(theme);
    setSaving(true);
    try {
      const [, result] = await Promise.all([
        updateIdentity.mutateAsync({ ...current, theme: "custom" }),
        settingsApi.updateConfig(customThemeConfigPayload(customThemes, theme.id)),
      ]);
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Custom theme update failed");
      }
    } catch (error) {
      restoreTheme(previousMode, previousThemes, previousActiveId);
      setDraftTheme(previousDraft);
      addToast("error", error instanceof Error ? error.message : "Failed to select custom theme");
    } finally {
      setSaving(false);
    }
  };

  const saveDraftTheme = async () => {
    if (!draftTheme || saving) return;
    const normalized = normalizeCustomThemeBundle(draftTheme);
    if (!normalized) {
      addToast("error", "Theme contains an invalid name, color, or font");
      return;
    }
    const previousThemes = customThemes;
    const previousActiveId = activeCustomThemeId;
    const previousMode = mode;
    const nextThemes = replaceTheme(customThemes, normalized);
    const current = (identity as IdentityConfig | undefined) ?? {};
    setCustomThemeCollection({ version: 1, themes: nextThemes, activeThemeId: normalized.id });
    setDraftTheme(normalized);
    setSaving(true);
    try {
      const [, result] = await Promise.all([
        updateIdentity.mutateAsync({ ...current, theme: "custom" }),
        settingsApi.updateConfig(customThemeConfigPayload(nextThemes, normalized.id)),
      ]);
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Custom theme save failed");
      }
      addToast("success", `${normalized.name} saved`);
    } catch (error) {
      restoreTheme(previousMode, previousThemes, previousActiveId);
      addToast("error", error instanceof Error ? error.message : "Failed to save custom theme");
    } finally {
      setSaving(false);
    }
  };

  const createTheme = () => {
    if (customThemes.length >= MAX_CUSTOM_THEMES) {
      addToast("error", `Custom themes are limited to ${MAX_CUSTOM_THEMES}`);
      return;
    }
    const id = uniqueThemeId(customThemes, "Custom theme");
    const theme = createCustomThemeBundle("Custom theme", id);
    upsertCustomTheme(theme);
    setCustomThemeCollection({
      version: 1,
      themes: [...customThemes, theme],
      activeThemeId: theme.id,
    });
    setDraftTheme(theme);
  };

  const importTheme = async (file: File) => {
    if (customThemes.length >= MAX_CUSTOM_THEMES) {
      addToast("error", `Custom themes are limited to ${MAX_CUSTOM_THEMES}`);
      return;
    }
    const previousMode = mode;
    const previousThemes = customThemes;
    const previousActiveId = activeCustomThemeId;
    const previousDraft = draftTheme;
    try {
      const imported = await readCustomThemeFile(file);
      const id = uniqueThemeId(customThemes, imported.id);
      const theme = {
        ...imported,
        id,
        name: id === imported.id ? imported.name : `${imported.name} Copy`,
      };
      const nextThemes = [...customThemes, theme];
      const current = (identity as IdentityConfig | undefined) ?? {};
      setCustomThemeCollection({ version: 1, themes: nextThemes, activeThemeId: id });
      setDraftTheme(theme);
      const [, result] = await Promise.all([
        updateIdentity.mutateAsync({ ...current, theme: "custom" }),
        settingsApi.updateConfig(customThemeConfigPayload(nextThemes, id)),
      ]);
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Theme import could not be saved");
      }
      addToast("success", `${theme.name} imported`);
    } catch (error) {
      restoreTheme(previousMode, previousThemes, previousActiveId);
      setDraftTheme(previousDraft);
      addToast("error", error instanceof Error ? error.message : "Failed to import theme");
    }
  };

  const deleteTheme = async () => {
    if (!draftTheme || saving) return;
    const previousThemes = customThemes;
    const previousActiveId = activeCustomThemeId;
    const previousMode = mode;
    const previousDraft = draftTheme;
    const nextThemes = customThemes.filter((theme) => theme.id !== draftTheme.id);
    const current = (identity as IdentityConfig | undefined) ?? {};
    setCustomThemeCollection({ version: 1, themes: nextThemes, activeThemeId: null });
    setMode("dark");
    setDraftTheme(null);
    setSaving(true);
    try {
      const [, result] = await Promise.all([
        updateIdentity.mutateAsync({ ...current, theme: "dark" }),
        settingsApi.updateConfig(customThemeConfigPayload(nextThemes, null)),
      ]);
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Theme deletion could not be saved");
      }
      addToast("success", "Custom theme deleted");
    } catch (error) {
      restoreTheme(previousMode, previousThemes, previousActiveId);
      setDraftTheme(previousDraft);
      addToast("error", error instanceof Error ? error.message : "Failed to delete custom theme");
    } finally {
      setSaving(false);
    }
  };

  const updateAccent = async (key: ThemeAccent) => {
    if (savingAccent || key === accent) return;
    const previous = accent;
    setAccent(key);
    setSavingAccent(key);
    try {
      const result = await settingsApi.updateConfig(themeConfigPayload(key));
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast("success", `${t("settings.accent")} changed to ${themeAccents[key].name}`);
    } catch {
      setAccent(previous);
      addToast("error", "Failed to update highlight color");
    } finally {
      setSavingAccent(null);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-[rgb(var(--accent-primary))]" />
          Appearance
        </CardTitle>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.cybara-theme.json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importTheme(file);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="theme-muted-icon-button rounded-md p-2"
            aria-label="Import theme"
            title="Import theme"
          >
            <Upload className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={createTheme}
            className="theme-muted-icon-button rounded-md p-2"
            aria-label="Create custom theme"
            title="New theme"
          >
            <Plus className="h-4 w-4" />
          </button>
          {draftTheme && (
            <>
              <button
                type="button"
                onClick={() => {
                  void copyCustomTheme(draftTheme)
                    .then(() => addToast("success", "Theme copied"))
                    .catch(() => addToast("error", "Clipboard access was denied"));
                }}
                className="theme-muted-icon-button rounded-md p-2"
                aria-label="Copy theme"
                title="Copy theme"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  void downloadCustomTheme(draftTheme)
                    .then((saved) => {
                      if (saved) addToast("success", "Theme exported");
                    })
                    .catch((error: unknown) =>
                      addToast(
                        "error",
                        error instanceof Error ? error.message : "Theme export failed"
                      )
                    );
                }}
                className="theme-muted-icon-button rounded-md p-2"
                aria-label="Export theme"
                title="Export theme"
              >
                <Download className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h4 className="text-sm font-medium text-[var(--text-primary)]">Presets</h4>
          <ThemePresetGrid
            mode={mode}
            options={themeModeOptions}
            disabled={updateIdentity.isPending || identityLoading}
            onSelect={(next) => void updateThemeMode(next)}
          />
        </section>

        {customThemes.length > 0 && (
          <section className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Custom themes</h4>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {customThemes.map((theme) => {
                const selected = activeCustomThemeId === theme.id && mode === "custom";
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => void activateCustomTheme(theme)}
                    className={cn(
                      "flex min-w-40 items-center gap-2 rounded-md border px-3 py-2 text-left",
                      selected
                        ? "border-[rgb(var(--accent-primary))] bg-[rgba(var(--accent-primary),0.08)]"
                        : "border-[var(--surface-border)] bg-[var(--surface-panel)] hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    <span
                      className="h-7 w-7 shrink-0 rounded-md border border-[var(--surface-border)]"
                      style={{
                        background: theme.dark.background,
                        boxShadow: `inset 0 -8px ${theme.dark.accent}`,
                      }}
                    />
                    <span className="min-w-0 truncate text-xs font-medium text-[var(--text-secondary)]">
                      {theme.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {draftTheme && (
          <CustomThemeEditor
            theme={draftTheme}
            saving={saving}
            onChange={(next) => {
              setDraftTheme(next);
              upsertCustomTheme(next);
              selectCustomTheme(next.id);
            }}
            onDelete={() => void deleteTheme()}
            onSave={() => void saveDraftTheme()}
          />
        )}

        <section className="grid gap-5 border-t border-[var(--surface-border)] pt-5 lg:grid-cols-[1fr_260px]">
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Preset highlight</h4>
            <div className="flex flex-wrap gap-2">
              {themeAccentKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={accent === key}
                  disabled={savingAccent !== null || mode === "custom"}
                  onClick={() => void updateAccent(key)}
                  className={cn(
                    "h-8 w-8 rounded-md border transition-transform",
                    accent === key
                      ? "scale-110 border-[var(--text-primary)]"
                      : "border-[var(--surface-border)] opacity-75 hover:scale-105 hover:opacity-100",
                    (savingAccent !== null || mode === "custom") && "cursor-not-allowed opacity-40"
                  )}
                  style={{ backgroundColor: `rgb(${themeAccents[key].primary})` }}
                  title={themeAccents[key].name}
                  aria-label={themeAccents[key].name}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Language</h4>
            <Select
              value={languageMode}
              onChange={(value) => {
                setLanguageMode(value as typeof languageMode);
                void settingsApi.updateConfig({ language: value }).catch(() => undefined);
              }}
              options={languageOptions(locale).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </div>
        </section>

        <section className="flex items-center justify-between gap-4 border-t border-[var(--surface-border)] pt-5">
          <div>
            <span className="text-sm text-[var(--text-secondary)]">Unread response color</span>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Used for the dot shown to the right of agents with unread responses.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="color"
              value={unreadDotColor}
              onChange={(event) => {
                setUnreadDotColor(event.target.value);
                persistUnreadDotColor(event.target.value);
              }}
              className="h-8 w-10 cursor-pointer rounded-md border border-[var(--surface-border)] bg-transparent p-0.5"
              aria-label="Unread response color"
            />
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: unreadDotColor }}
              aria-hidden="true"
            />
          </label>
        </section>

        <section className="flex items-center justify-between gap-4 border-t border-[var(--surface-border)] pt-5">
          <span className="text-sm text-[var(--text-secondary)]">Show Cybara pet</span>
          <button
            type="button"
            role="switch"
            aria-checked={petEnabled}
            onClick={() => {
              const next = !petEnabled;
              setPetEnabled(next);
              persistPetEnabled(next);
            }}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
              petEnabled ? "bg-[rgb(var(--accent-primary))]" : "bg-[var(--surface-raised)]"
            )}
            aria-label={petEnabled ? "Hide pet" : "Show pet"}
          >
            <span
              className={cn(
                "h-5 w-5 rounded-full bg-white shadow transition-transform",
                petEnabled ? "translate-x-[22px]" : "translate-x-0.5"
              )}
            />
          </button>
        </section>
      </CardContent>
    </Card>
  );
}
