import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { settingsApi } from "@/lib/api";
import { useIdentity, useUpdateIdentity, type IdentityConfig } from "@/hooks/useApi";
import { persistPetEnabled, readPetEnabled } from "@/lib/petPreferences";
import { languageOptions, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/settingsFormat";
import {
  defaultThemeAccentForMode,
  readThemeAccentFromConfig,
  readThemeModeFromIdentity,
  themeAccentKeys,
  themeAccents,
  themeConfigPayload,
  themeModeOptions,
  useUIStore,
  type ThemeAccent,
  type ThemeMode,
} from "@/stores/uiStore";
import { Monitor, Palette } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeSettings() {
  const { accent, setAccent, mode, setMode, addToast } = useUIStore();
  const { locale, mode: languageMode, setMode: setLanguageMode, t } = useI18n();
  const [savingAccent, setSavingAccent] = useState<ThemeAccent | null>(null);
  const [petEnabled, setPetEnabled] = useState(() => readPetEnabled());
  const { data: identity, isLoading: identityLoading } = useIdentity();
  const updateIdentity = useUpdateIdentity();

  useEffect(() => {
    const nextMode = readThemeModeFromIdentity(
      identity as unknown as Record<string, unknown> | undefined
    );
    setMode(nextMode);
  }, [identity, setMode]);

  const updateThemeMode = async (next: ThemeMode) => {
    if (next === mode) return;
    const previousMode = mode;
    const previousAccent = accent;
    const nextAccent = defaultThemeAccentForMode(next);
    const current = (identity as IdentityConfig | undefined) ?? {};
    setMode(next);
    setAccent(nextAccent);
    setSavingAccent(nextAccent);
    try {
      const [, accentResult] = await Promise.all([
        updateIdentity.mutateAsync({ ...current, theme: next }),
        settingsApi.updateConfig(themeConfigPayload(nextAccent)),
      ]);
      if (!accentResult.success || !accentResult.data?.success) {
        throw new Error(accentResult.error || "Highlight update failed");
      }
      addToast(
        "success",
        `${t("settings.theme")} set to ${next}; ${themeAccents[nextAccent].name} highlight applied`
      );
    } catch (error) {
      await Promise.allSettled([
        updateIdentity.mutateAsync({ ...current, theme: previousMode }),
        settingsApi.updateConfig(themeConfigPayload(previousAccent)),
      ]);
      setMode(previousMode);
      setAccent(previousAccent);
      addToast("error", error instanceof Error ? error.message : "Failed to update theme");
    } finally {
      setSavingAccent(null);
    }
  };

  const accentColors: Record<ThemeAccent, string> = {
    indigo: "bg-indigo-500",
    blue: "bg-blue-500",
    cyan: "bg-cyan-500",
    teal: "bg-teal-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    orange: "bg-orange-500",
    rose: "bg-rose-500",
    pink: "bg-pink-500",
    purple: "bg-purple-500",
  };

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
      addToast("error", "Failed to update theme");
    } finally {
      setSavingAccent(null);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-[rgb(var(--accent-primary))]" />
          {t("settings.theme")}
        </CardTitle>
        <CardDescription>{t("settings.themeHelp")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-200">{t("settings.theme")}</p>
                <p className="text-xs text-gray-500">{t("settings.themeHelp")}</p>
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label={t("settings.theme")}
              className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/20 p-1 sm:grid-cols-4"
            >
              {themeModeOptions.map((option) => {
                const selected = mode === option.value;
                const label =
                  option.value === "system"
                    ? t("settings.themeSystem")
                    : option.value === "light"
                      ? t("settings.themeLight")
                      : option.value === "dark"
                        ? t("settings.themeDark")
                        : option.label;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={updateIdentity.isPending || identityLoading}
                    onClick={() => void updateThemeMode(option.value)}
                    className={cn(
                      "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                      selected
                        ? "border border-[rgba(var(--accent-primary),0.32)] bg-[rgba(var(--accent-primary),0.13)] text-[rgb(var(--accent-primary))] shadow-sm"
                        : "text-gray-400 hover:bg-white/5 hover:text-gray-200",
                      (updateIdentity.isPending || identityLoading) &&
                        "cursor-not-allowed opacity-60"
                    )}
                  >
                    {option.value === "system" ? (
                      <Monitor className="h-4 w-4" />
                    ) : (
                      <span
                        aria-hidden
                        className="h-4 w-4 shrink-0 rounded-full border border-white/25"
                        style={{ backgroundColor: option.swatch }}
                      />
                    )}
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium text-gray-200">{t("settings.language")}</p>
              <p className="text-xs text-gray-500">{t("settings.languageHelp")}</p>
            </div>
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
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-200">Show Cybara pet</p>
              <p className="text-xs text-gray-500">
                A floating capybara that watches your running sessions. Drag it anywhere; click it
                to jump into an active chat.
              </p>
            </div>
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
                "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors",
                petEnabled ? "bg-[rgb(var(--accent-primary))]" : "bg-white/15"
              )}
              aria-label={petEnabled ? "Hide pet" : "Show pet"}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                  petEnabled ? "translate-x-[22px]" : "translate-x-0.5"
                )}
              />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {themeAccentKeys.map((key) => (
            <button
              key={key}
              aria-pressed={accent === key}
              disabled={savingAccent !== null}
              onClick={() => void updateAccent(key)}
              className={cn(
                "w-12 h-12 rounded-xl transition-all cursor-pointer",
                accentColors[key],
                accent === key
                  ? "ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0f] scale-110"
                  : "hover:scale-105 opacity-70 hover:opacity-100",
                savingAccent !== null && "cursor-not-allowed"
              )}
              title={themeAccents[key].name}
            />
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {t("settings.accent")}: {themeAccents[accent].name}
        </p>
      </CardContent>
    </Card>
  );
}
