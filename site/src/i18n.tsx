import {
  detectLocale,
  localeDirections,
  translate,
  type SupportedLocale,
  type TranslationKey,
} from "../../shared/i18n/catalog";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

function systemLocale(): SupportedLocale {
  return detectLocale(Array.from(navigator.languages || [navigator.language]));
}

interface SiteI18nValue {
  locale: SupportedLocale;
  t: (key: TranslationKey) => string;
}

const SiteI18nContext = createContext<SiteI18nValue>({
  locale: "en",
  t: (key) => translate("en", key),
});

export function SiteI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(systemLocale);

  useEffect(() => {
    const update = () => setLocale(systemLocale());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirections[locale];
  }, [locale]);

  const value = useMemo<SiteI18nValue>(
    () => ({
      locale,
      t: (key) => translate(locale, key),
    }),
    [locale]
  );

  return <SiteI18nContext.Provider value={value}>{children}</SiteI18nContext.Provider>;
}

export function useSiteI18n(): SiteI18nValue {
  return useContext(SiteI18nContext);
}
