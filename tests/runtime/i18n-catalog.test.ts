import { describe, expect, test } from "bun:test";
import {
  catalogForLocale,
  detectLocale,
  localeDirections,
  supportedLocales,
  translations,
  type TranslationKey,
} from "../../shared/i18n/catalog";

const englishKeys = Object.keys(translations.en) as TranslationKey[];

describe("shared i18n catalog", () => {
  test("provides complete non-empty translations for every supported locale", () => {
    for (const locale of supportedLocales) {
      const catalog = catalogForLocale(locale);
      expect(Object.keys(catalog).sort()).toEqual([...englishKeys].sort());
      for (const key of englishKeys) {
        expect(catalog[key].trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("normalizes common browser and native locale identifiers", () => {
    expect(detectLocale(["es-MX"])).toBe("es");
    expect(detectLocale(["zh-Hans-CN"])).toBe("zh-CN");
    expect(detectLocale(["zh-Hant-TW"])).toBe("zh-TW");
    expect(detectLocale(["zh-HK"])).toBe("zh-TW");
    expect(detectLocale(["pt-PT"])).toBe("pt-BR");
    expect(detectLocale(["it-IT"])).toBe("it");
    expect(detectLocale(["th-TH"])).toBe("th");
    expect(detectLocale(["ar-SA"])).toBe("ar");
    expect(detectLocale(["ru-RU"])).toBe("ru");
    expect(detectLocale(["uk-UA"])).toBe("uk");
    expect(detectLocale(["sv-SE"])).toBe("sv");
    expect(detectLocale(["da-DK"])).toBe("da");
    expect(detectLocale(["fi-FI"])).toBe("fi");
    expect(detectLocale(["zz-ZZ"])).toBe("en");
  });

  test("marks Arabic as RTL and keeps other shipped locales LTR", () => {
    expect(localeDirections.ar).toBe("rtl");
    for (const locale of supportedLocales.filter((locale) => locale !== "ar")) {
      expect(localeDirections[locale]).toBe("ltr");
    }
  });
});
