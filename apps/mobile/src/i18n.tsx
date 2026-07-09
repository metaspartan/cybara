import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  detectLocale,
  localeDirections,
  supportedLocales,
  translate,
  type SupportedLocale,
  type TranslationKey,
} from "cybara-shared/i18n/catalog";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type MobileLanguageMode = "system" | SupportedLocale;

const STORAGE_KEY = "cybara.language";

function systemLocale(): SupportedLocale {
  const locale =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().locale : undefined;
  return detectLocale([locale]);
}

interface MobileI18nValue {
  locale: SupportedLocale;
  direction: "ltr" | "rtl";
  mode: MobileLanguageMode;
  setMode: (mode: MobileLanguageMode) => void;
  t: (key: TranslationKey) => string;
}

const MobileI18nContext = createContext<MobileI18nValue>({
  locale: "en",
  direction: "ltr",
  mode: "system",
  setMode: () => {},
  t: (key) => translate("en", key),
});

export function MobileI18nProvider({ children }: { children: ReactNode }) {
  const [system, setSystem] = useState(systemLocale);
  const [mode, setModeState] = useState<MobileLanguageMode>("system");

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!mounted) return;
        if (stored === "system" || supportedLocales.includes(stored as SupportedLocale)) {
          setModeState(stored as MobileLanguageMode);
        }
      })
      .catch(() => {});
    setSystem(systemLocale());
    return () => {
      mounted = false;
    };
  }, []);

  const setMode = (next: MobileLanguageMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const locale = mode === "system" ? system : mode;

  const value = useMemo<MobileI18nValue>(
    () => ({
      locale,
      direction: localeDirections[locale],
      mode,
      setMode,
      t: (key) => translate(locale, key),
    }),
    [locale, mode]
  );

  return <MobileI18nContext.Provider value={value}>{children}</MobileI18nContext.Provider>;
}

export function useMobileI18n(): MobileI18nValue {
  return useContext(MobileI18nContext);
}
