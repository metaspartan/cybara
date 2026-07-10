import {
  detectLocale,
  localeDirections,
  localeLabels,
  supportedLocales,
  translate,
  type SupportedLocale,
  type TranslationKey,
} from "../../../shared/i18n/catalog";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type LanguageMode = "system" | SupportedLocale;

const STORAGE_KEY = "cybara.language";

function systemLocale(): SupportedLocale {
  return detectLocale(Array.from(navigator.languages || [navigator.language]));
}

function readLanguageMode(): LanguageMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "system") return "system";
    if (supportedLocales.includes(stored as SupportedLocale)) return stored as SupportedLocale;
  } catch {}
  return "system";
}

function writeLanguageMode(mode: LanguageMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {}
}

interface I18nContextValue {
  locale: SupportedLocale;
  mode: LanguageMode;
  setMode: (mode: LanguageMode) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  mode: "system",
  setMode: () => {},
  t: (key, params) => translate("en", key, params),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [system, setSystem] = useState(systemLocale);
  const [mode, setModeState] = useState<LanguageMode>(readLanguageMode);

  useEffect(() => {
    const update = () => setSystem(systemLocale());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  const setMode = (next: LanguageMode) => {
    setModeState(next);
    writeLanguageMode(next);
  };

  const locale = mode === "system" ? system : mode;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirections[locale];
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      mode,
      setMode,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, mode]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function languageOptions(
  locale: SupportedLocale
): Array<{ value: LanguageMode; label: string }> {
  return [
    { value: "system", label: translate(locale, "settings.languageSystem") },
    ...supportedLocales.map((locale) => ({ value: locale, label: localeLabels[locale] })),
  ];
}
